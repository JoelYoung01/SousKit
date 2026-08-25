"""Household membership, invites, and data-scoping helpers."""

from __future__ import annotations

import secrets
from datetime import UTC, datetime, timedelta

from fastapi import HTTPException, status
from sqlmodel import Session, col, func, or_, select

from api.core.config import settings
from api.models import (
    GroceryItemState,
    GroceryManualItem,
    Household,
    HouseholdInvite,
    HouseholdInviteStatus,
    HouseholdMember,
    HouseholdRole,
    PlannedRecipe,
    Recipe,
    User,
)

MAX_HOUSEHOLD_MEMBERS = 8
INVITE_EXPIRY_DAYS = 14


def invite_join_url(token: str) -> str:
    """HTTPS join URL for QR / copy-link sharing (Universal Link friendly)."""
    base = settings.FRONTEND_HOST.rstrip("/")
    path = settings.HOUSEHOLD_JOIN_PATH.strip("/")
    return f"{base}/{path}/{token}"


def default_household_name(display_name: str) -> str:
    name = (display_name or "").strip() or "My"
    return f"{name}'s kitchen"


def create_household_for_user(
    session: Session,
    user: User,
    *,
    name: str | None = None,
) -> Household:
    """Create a solo household and owner membership for ``user``."""
    household = Household(
        name=name or default_household_name(user.display_name),
        created_by_id=user.id,
        created_on=datetime.now(UTC),
    )
    session.add(household)
    session.commit()
    session.refresh(household)

    membership = HouseholdMember(
        household_id=household.id,
        user_id=user.id,
        role=HouseholdRole.owner.value,
        joined_on=datetime.now(UTC),
    )
    session.add(membership)
    session.commit()
    return household


def ensure_user_household(session: Session, user: User) -> Household:
    """Return the user's household, creating a solo one if missing."""
    membership = session.exec(
        select(HouseholdMember).where(HouseholdMember.user_id == user.id)
    ).first()
    if membership:
        household = session.get(Household, membership.household_id)
        if household:
            return household
    return create_household_for_user(session, user)


def get_membership(session: Session, user_id: int) -> HouseholdMember | None:
    return session.exec(
        select(HouseholdMember).where(HouseholdMember.user_id == user_id)
    ).first()


def get_user_household(session: Session, user_id: int) -> Household | None:
    membership = get_membership(session, user_id)
    if not membership:
        return None
    return session.get(Household, membership.household_id)


def require_membership(
    session: Session, user: User
) -> tuple[Household, HouseholdMember]:
    membership = get_membership(session, user.id)
    if not membership:
        household = ensure_user_household(session, user)
        membership = get_membership(session, user.id)
        if not membership:
            raise HTTPException(status_code=500, detail="Couldn’t load your household.")
        return household, membership
    household = session.get(Household, membership.household_id)
    if not household:
        raise HTTPException(status_code=500, detail="Couldn’t load your household.")
    return household, membership


def require_owner(session: Session, user: User) -> tuple[Household, HouseholdMember]:
    household, membership = require_membership(session, user)
    if membership.role != HouseholdRole.owner.value:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the household owner can do that.",
        )
    return household, membership


def member_count(session: Session, household_id: int) -> int:
    return session.exec(
        select(func.count())
        .select_from(HouseholdMember)
        .where(HouseholdMember.household_id == household_id)
    ).one()


def list_members(session: Session, household_id: int) -> list[HouseholdMember]:
    return list(
        session.exec(
            select(HouseholdMember)
            .where(HouseholdMember.household_id == household_id)
            .order_by(HouseholdMember.joined_on)
        ).all()
    )


def recipe_access_filter(household_id: int):
    """SQLAlchemy filter: public OR same household."""
    return or_(Recipe.public, Recipe.household_id == household_id)


def user_can_access_recipe(session: Session, user: User, recipe: Recipe) -> bool:
    if recipe.public:
        return True
    membership = get_membership(session, user.id)
    if not membership:
        return recipe.created_by_id == user.id
    return recipe.household_id == membership.household_id


def user_can_edit_recipe(session: Session, user: User, recipe: Recipe) -> bool:
    membership = get_membership(session, user.id)
    if not membership:
        return recipe.created_by_id == user.id
    return recipe.household_id == membership.household_id


def user_can_edit_plan(session: Session, user: User, plan: PlannedRecipe) -> bool:
    membership = get_membership(session, user.id)
    if not membership:
        return plan.created_by_id == user.id
    return plan.household_id == membership.household_id


def migrate_household_data(
    session: Session, *, from_household_id: int, to_household_id: int
) -> None:
    """Move recipes, plans, and grocery state from one household into another."""
    for recipe in session.exec(
        select(Recipe).where(Recipe.household_id == from_household_id)
    ).all():
        recipe.household_id = to_household_id
        session.add(recipe)

    for plan in session.exec(
        select(PlannedRecipe).where(PlannedRecipe.household_id == from_household_id)
    ).all():
        plan.household_id = to_household_id
        session.add(plan)

    target_keys = {
        s.item_key
        for s in session.exec(
            select(GroceryItemState).where(
                GroceryItemState.household_id == to_household_id
            )
        ).all()
    }
    for state in session.exec(
        select(GroceryItemState).where(
            GroceryItemState.household_id == from_household_id
        )
    ).all():
        if state.item_key in target_keys:
            session.delete(state)
        else:
            state.household_id = to_household_id
            session.add(state)

    for manual in session.exec(
        select(GroceryManualItem).where(
            GroceryManualItem.household_id == from_household_id
        )
    ).all():
        manual.household_id = to_household_id
        session.add(manual)

    session.commit()


def dissolve_household_if_empty(session: Session, household_id: int) -> None:
    if member_count(session, household_id) > 0:
        return
    # Orphan data should not remain — delete grocery state, plans, recipes.
    for state in session.exec(
        select(GroceryItemState).where(GroceryItemState.household_id == household_id)
    ).all():
        session.delete(state)
    for manual in session.exec(
        select(GroceryManualItem).where(GroceryManualItem.household_id == household_id)
    ).all():
        session.delete(manual)
    for plan in session.exec(
        select(PlannedRecipe).where(PlannedRecipe.household_id == household_id)
    ).all():
        session.delete(plan)
    for recipe in session.exec(
        select(Recipe).where(Recipe.household_id == household_id)
    ).all():
        session.delete(recipe)
    for invite in session.exec(
        select(HouseholdInvite).where(HouseholdInvite.household_id == household_id)
    ).all():
        session.delete(invite)
    household = session.get(Household, household_id)
    if household:
        session.delete(household)
    session.commit()


def create_invite(
    session: Session,
    *,
    household: Household,
    invited_by: User,
) -> HouseholdInvite:
    """Create a single-use shareable link/QR invite (no email binding)."""
    if member_count(session, household.id) >= MAX_HOUSEHOLD_MEMBERS:
        raise HTTPException(
            status_code=400,
            detail=f"Households can have at most {MAX_HOUSEHOLD_MEMBERS} people.",
        )

    invite = HouseholdInvite(
        household_id=household.id,
        email=None,
        invited_by_id=invited_by.id,
        token=secrets.token_urlsafe(32),
        status=HouseholdInviteStatus.pending.value,
        created_on=datetime.now(UTC),
        expires_on=datetime.now(UTC) + timedelta(days=INVITE_EXPIRY_DAYS),
    )
    session.add(invite)
    session.commit()
    session.refresh(invite)
    return invite


def accept_invite(session: Session, *, user: User, token: str) -> Household:
    invite = session.exec(
        select(HouseholdInvite).where(HouseholdInvite.token == token)
    ).first()
    if not invite:
        raise HTTPException(status_code=404, detail="That invite couldn’t be found.")
    if invite.status != HouseholdInviteStatus.pending.value:
        raise HTTPException(status_code=400, detail="That invite is no longer valid.")
    if invite.expires_on <= datetime.now(UTC):
        invite.status = HouseholdInviteStatus.expired.value
        session.add(invite)
        session.commit()
        raise HTTPException(status_code=400, detail="That invite has expired.")

    # Legacy email-bound invites still require the invited address.
    if invite.email and user.email.strip().lower() != invite.email.strip().lower():
        raise HTTPException(
            status_code=403,
            detail="Sign in with the email this invite was sent to.",
        )

    target = session.get(Household, invite.household_id)
    if not target:
        raise HTTPException(status_code=404, detail="That household no longer exists.")

    if member_count(session, target.id) >= MAX_HOUSEHOLD_MEMBERS:
        raise HTTPException(
            status_code=400,
            detail=f"Households can have at most {MAX_HOUSEHOLD_MEMBERS} people.",
        )

    current_membership = get_membership(session, user.id)
    if current_membership and current_membership.household_id == target.id:
        invite.status = HouseholdInviteStatus.accepted.value
        session.add(invite)
        session.commit()
        return target

    if current_membership:
        current_household_id = current_membership.household_id
        others = member_count(session, current_household_id) - 1
        if others > 0:
            raise HTTPException(
                status_code=400,
                detail=(
                    "Leave your current household before joining another one. "
                    "Shared data stays with the household you leave."
                ),
            )
        # Solo household: migrate data, then dissolve membership + household.
        migrate_household_data(
            session,
            from_household_id=current_household_id,
            to_household_id=target.id,
        )
        session.delete(current_membership)
        session.commit()
        dissolve_household_if_empty(session, current_household_id)

    membership = HouseholdMember(
        household_id=target.id,
        user_id=user.id,
        role=HouseholdRole.member.value,
        joined_on=datetime.now(UTC),
    )
    session.add(membership)
    invite.status = HouseholdInviteStatus.accepted.value
    session.add(invite)
    session.commit()
    return target


def leave_household(session: Session, user: User) -> Household:
    """Leave a shared household. Solo households are kept as-is (data stays)."""
    membership = get_membership(session, user.id)
    if not membership:
        return create_household_for_user(session, user)

    old_household_id = membership.household_id
    remaining = [
        m for m in list_members(session, old_household_id) if m.user_id != user.id
    ]
    if not remaining:
        # Already solo — nothing to leave; keep data where it is.
        household = session.get(Household, old_household_id)
        if household:
            return household
        return create_household_for_user(session, user)

    was_owner = membership.role == HouseholdRole.owner.value
    session.delete(membership)
    session.commit()

    if was_owner:
        successor = remaining[0]
        successor.role = HouseholdRole.owner.value
        session.add(successor)
        session.commit()

    # Fresh empty kitchen for the leaver; shared data stays with the old household.
    return create_household_for_user(session, user)


def remove_member(session: Session, *, owner: User, target_user_id: int) -> None:
    household, _ = require_owner(session, owner)
    if target_user_id == owner.id:
        raise HTTPException(
            status_code=400,
            detail="Use leave to exit your own household.",
        )
    membership = session.exec(
        select(HouseholdMember).where(
            HouseholdMember.household_id == household.id,
            HouseholdMember.user_id == target_user_id,
        )
    ).first()
    if not membership:
        raise HTTPException(
            status_code=404, detail="That member isn’t in this household."
        )

    session.delete(membership)
    session.commit()

    # Give the removed user a fresh solo household.
    target_user = session.get(User, target_user_id)
    if target_user and get_membership(session, target_user_id) is None:
        create_household_for_user(session, target_user)


def backfill_households(session: Session) -> int:
    """Ensure every user has a household and attach orphaned rows. Returns users touched."""
    users = list(session.exec(select(User)).all())
    touched = 0
    for user in users:
        before = get_membership(session, user.id)
        household = ensure_user_household(session, user)
        if before is None:
            touched += 1
        # Attach any rows still missing household_id for this user.
        for recipe in session.exec(
            select(Recipe).where(
                Recipe.created_by_id == user.id,
                col(Recipe.household_id).is_(None),
            )
        ).all():
            recipe.household_id = household.id
            session.add(recipe)
        for plan in session.exec(
            select(PlannedRecipe).where(
                PlannedRecipe.created_by_id == user.id,
                col(PlannedRecipe.household_id).is_(None),
            )
        ).all():
            plan.household_id = household.id
            session.add(plan)
        for state in session.exec(
            select(GroceryItemState).where(
                GroceryItemState.created_by_id == user.id,
                col(GroceryItemState.household_id).is_(None),
            )
        ).all():
            state.household_id = household.id
            session.add(state)
        session.commit()
    return touched
