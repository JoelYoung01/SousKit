"""Household membership and invite endpoints."""

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import selectinload
from sqlmodel import select

from api.core.authentication import CurrentUserDep, verify_access_token
from api.core.database import SessionDep
from api.core.household import (
    MAX_HOUSEHOLD_MEMBERS,
    accept_invite,
    create_invite,
    invite_join_url,
    leave_household,
    list_members,
    remove_member,
    require_membership,
    require_owner,
)
from api.models import HouseholdInvite, HouseholdInviteStatus, User
from api.schemas import (
    HouseholdInviteAccept,
    HouseholdInviteResponse,
    HouseholdMemberResponse,
    HouseholdResponse,
    HouseholdUpdate,
    PendingHouseholdInviteResponse,
)

router = APIRouter(
    prefix="/household",
    dependencies=[Depends(verify_access_token)],
    tags=["Household"],
)


def _member_response(member, user: User) -> HouseholdMemberResponse:
    return HouseholdMemberResponse(
        user_id=member.user_id,
        role=member.role,
        joined_on=member.joined_on,
        display_name=user.display_name,
        email=user.email,
        avatar_url=user.avatar_url,
    )


def _invite_response(
    invite: HouseholdInvite, *, include_token: bool
) -> HouseholdInviteResponse:
    token = invite.token if include_token else None
    return HouseholdInviteResponse(
        id=invite.id,
        email=invite.email,
        status=invite.status,
        created_on=invite.created_on,
        expires_on=invite.expires_on,
        invited_by_id=invite.invited_by_id,
        token=token,
        invite_url=invite_join_url(invite.token) if token else None,
    )


def _household_response(
    session: SessionDep,
    household,
    membership,
) -> HouseholdResponse:
    members = list_members(session, household.id)
    user_ids = [m.user_id for m in members]
    users = {
        u.id: u for u in session.exec(select(User).where(User.id.in_(user_ids))).all()
    }
    member_payloads = [
        _member_response(m, users[m.user_id]) for m in members if m.user_id in users
    ]

    pending = session.exec(
        select(HouseholdInvite)
        .where(
            HouseholdInvite.household_id == household.id,
            HouseholdInvite.status == HouseholdInviteStatus.pending.value,
            HouseholdInvite.expires_on > datetime.now(UTC),
        )
        .order_by(HouseholdInvite.created_on.desc())
    ).all()
    is_owner = membership.role == "owner"

    return HouseholdResponse(
        id=household.id,
        name=household.name,
        created_by_id=household.created_by_id,
        created_on=household.created_on,
        my_role=membership.role,
        member_count=len(member_payloads),
        max_members=MAX_HOUSEHOLD_MEMBERS,
        members=member_payloads,
        pending_invites=[
            _invite_response(inv, include_token=is_owner) for inv in pending
        ],
    )


@router.get("/", response_model=HouseholdResponse)
def get_my_household(current_user: CurrentUserDep, session: SessionDep):
    household, membership = require_membership(session, current_user)
    return _household_response(session, household, membership)


@router.patch("/", response_model=HouseholdResponse)
def rename_household(
    body: HouseholdUpdate,
    current_user: CurrentUserDep,
    session: SessionDep,
):
    household, membership = require_owner(session, current_user)
    household.name = body.name.strip()
    session.add(household)
    session.commit()
    session.refresh(household)
    return _household_response(session, household, membership)


@router.post("/leave/", response_model=HouseholdResponse)
def leave_my_household(current_user: CurrentUserDep, session: SessionDep):
    household = leave_household(session, current_user)
    membership = require_membership(session, current_user)[1]
    return _household_response(session, household, membership)


@router.delete("/members/{user_id}/", status_code=status.HTTP_204_NO_CONTENT)
def remove_household_member(
    user_id: int,
    current_user: CurrentUserDep,
    session: SessionDep,
):
    remove_member(session, owner=current_user, target_user_id=user_id)


@router.post("/invites/", response_model=HouseholdInviteResponse, status_code=201)
def invite_to_household(
    current_user: CurrentUserDep,
    session: SessionDep,
):
    """Create a single-use join link (QR / copy URL) for the household."""
    household, _ = require_owner(session, current_user)
    invite = create_invite(
        session,
        household=household,
        invited_by=current_user,
    )
    return _invite_response(invite, include_token=True)


@router.delete("/invites/{invite_id}/", status_code=status.HTTP_204_NO_CONTENT)
def revoke_invite(
    invite_id: int,
    current_user: CurrentUserDep,
    session: SessionDep,
):
    household, _ = require_owner(session, current_user)
    invite = session.get(HouseholdInvite, invite_id)
    if not invite or invite.household_id != household.id:
        raise HTTPException(status_code=404, detail="That invite couldn’t be found.")
    if invite.status == HouseholdInviteStatus.pending.value:
        invite.status = HouseholdInviteStatus.revoked.value
        session.add(invite)
        session.commit()


@router.post("/invites/accept/", response_model=HouseholdResponse)
def accept_household_invite(
    body: HouseholdInviteAccept,
    current_user: CurrentUserDep,
    session: SessionDep,
):
    household = accept_invite(session, user=current_user, token=body.token.strip())
    membership = require_membership(session, current_user)[1]
    return _household_response(session, household, membership)


@router.get(
    "/invites/pending/",
    response_model=list[PendingHouseholdInviteResponse],
)
def list_pending_invites_for_me(
    current_user: CurrentUserDep,
    session: SessionDep,
):
    """Legacy email-addressed invites still waiting for this user."""
    email = current_user.email.strip().lower()
    invites = session.exec(
        select(HouseholdInvite)
        .where(
            HouseholdInvite.email == email,
            HouseholdInvite.status == HouseholdInviteStatus.pending.value,
            HouseholdInvite.expires_on > datetime.now(UTC),
        )
        .options(
            selectinload(HouseholdInvite.household),
            selectinload(HouseholdInvite.invited_by),
        )
        .order_by(HouseholdInvite.created_on.desc())
    ).all()
    result: list[PendingHouseholdInviteResponse] = []
    for inv in invites:
        household = inv.household
        inviter = inv.invited_by
        if not household:
            continue
        result.append(
            PendingHouseholdInviteResponse(
                id=inv.id,
                household_id=household.id,
                household_name=household.name,
                invited_by_name=inviter.display_name if inviter else "Someone",
                token=inv.token,
                invite_url=invite_join_url(inv.token),
                created_on=inv.created_on,
                expires_on=inv.expires_on,
            )
        )
    return result
