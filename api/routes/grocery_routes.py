from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import selectinload
from sqlmodel import select

from api.core.authentication import CurrentUserDep, verify_access_token
from api.core.database import SessionDep
from api.core.grocery import (
    aggregate_grocery_items,
    infer_category,
    normalize_item_key,
    should_auto_dismiss,
    window_bounds,
)
from api.core.household import require_membership
from api.models import (
    GroceryItemState,
    GroceryItemStatus,
    GroceryManualItem,
    PlannedRecipe,
    Recipe,
)
from api.schemas import (
    GroceryItem,
    GroceryItemStateUpdate,
    GroceryListResponse,
    GroceryManualItemCreate,
    GroceryQuantity,
    GrocerySummaryResponse,
)

router = APIRouter(
    prefix="/grocery",
    dependencies=[Depends(verify_access_token)],
    tags=["Grocery"],
)


def _item_dismissed(
    *,
    state: GroceryItemState | None,
    latest_planned_for: datetime | None,
    is_manual: bool,
    today,
) -> tuple[bool, bool]:
    """Return (dismissed, auto_dismissed)."""
    if state and state.status == GroceryItemStatus.deleted.value:
        return False, False
    if state and state.status == GroceryItemStatus.restored.value:
        return False, False
    if state and state.status == GroceryItemStatus.dismissed.value:
        return True, False
    auto = (
        not is_manual
        and should_auto_dismiss(latest_planned_for, today)
    )
    return auto, auto


def _build_grocery_items(
    current_user: CurrentUserDep,
    session: SessionDep,
    *,
    include_deleted: bool = False,
) -> tuple[datetime, datetime, list[GroceryItem]]:
    now = datetime.now(UTC)
    start, end = window_bounds(now)
    household, _ = require_membership(session, current_user)
    today = now.date()

    planned = session.exec(
        select(PlannedRecipe)
        .where(
            PlannedRecipe.household_id == household.id,
            PlannedRecipe.planned_for >= start,
            PlannedRecipe.planned_for <= end,
        )
        .options(selectinload(PlannedRecipe.recipe).selectinload(Recipe.ingredients))
    ).all()

    manual_items = session.exec(
        select(GroceryManualItem).where(
            GroceryManualItem.household_id == household.id
        )
    ).all()

    aggregated = aggregate_grocery_items(list(planned), list(manual_items))

    states = session.exec(
        select(GroceryItemState).where(
            GroceryItemState.household_id == household.id
        )
    ).all()
    state_by_key = {s.item_key: s for s in states}

    items: list[GroceryItem] = []
    for raw in aggregated:
        state = state_by_key.get(raw["key"])
        dismissed, auto_dismissed = _item_dismissed(
            state=state,
            latest_planned_for=raw.get("latest_planned_for"),
            is_manual=raw.get("is_manual", False),
            today=today,
        )
        deleted = bool(state and state.status == GroceryItemStatus.deleted.value)
        if deleted and not include_deleted:
            continue
        items.append(
            GroceryItem(
                **{k: v for k, v in raw.items() if k != "latest_planned_for"},
                dismissed=dismissed,
                auto_dismissed=auto_dismissed,
                deleted=deleted,
            )
        )

    return start, end, items


@router.get("/", response_model=GroceryListResponse)
def get_grocery_list(
    current_user: CurrentUserDep,
    session: SessionDep,
    include_deleted: bool = False,
):
    start, end, items = _build_grocery_items(
        current_user, session, include_deleted=include_deleted
    )
    return GroceryListResponse(
        window_start=start,
        window_end=end,
        items=items,
    )


@router.get("/summary/", response_model=GrocerySummaryResponse)
def get_grocery_summary(
    current_user: CurrentUserDep,
    session: SessionDep,
):
    """Lightweight badge payload for Home — skips shipping the full item list."""
    start, end, items = _build_grocery_items(current_user, session)
    active_count = sum(1 for i in items if not i.dismissed and not i.deleted)
    return GrocerySummaryResponse(
        window_start=start,
        window_end=end,
        active_count=active_count,
    )


@router.post("/items/", response_model=GroceryItem)
def create_manual_grocery_item(
    body: GroceryManualItemCreate,
    current_user: CurrentUserDep,
    session: SessionDep,
):
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Enter an item name.")

    household, _ = require_membership(session, current_user)
    key = normalize_item_key(name)
    if not key:
        raise HTTPException(status_code=400, detail="Enter an item name.")

    manual = GroceryManualItem(
        created_by_id=current_user.id,
        household_id=household.id,
        name=name,
        item_key=key,
        amount=body.amount,
        units=(body.units or "").strip() or None,
        created_on=datetime.now(UTC),
    )
    session.add(manual)
    session.commit()
    session.refresh(manual)

    grocery = get_grocery_list(
        current_user=current_user, session=session, include_deleted=True
    )
    for item in grocery.items:
        if item.key == key:
            return item

    return GroceryItem(
        key=key,
        name=name,
        category=infer_category(name),
        quantities=[GroceryQuantity(amount=body.amount, units=manual.units)],
        quantity_display="",
        recipes=[],
        recipe_titles="Added manually",
        source_ingredient_ids=[],
        manual_item_ids=[manual.id],
        is_manual=True,
        dismissed=False,
        auto_dismissed=False,
        deleted=False,
    )


@router.delete("/items/{item_id}/", status_code=204)
def delete_manual_grocery_item(
    item_id: int,
    current_user: CurrentUserDep,
    session: SessionDep,
):
    household, _ = require_membership(session, current_user)
    manual = session.get(GroceryManualItem, item_id)
    if not manual or manual.household_id != household.id:
        raise HTTPException(status_code=404, detail="That grocery item couldn’t be found.")

    state = session.exec(
        select(GroceryItemState).where(
            GroceryItemState.household_id == household.id,
            GroceryItemState.item_key == manual.item_key,
        )
    ).first()
    if state:
        session.delete(state)
    session.delete(manual)
    session.commit()


@router.put("/state/", response_model=GroceryItem)
def update_grocery_item_state(
    body: GroceryItemStateUpdate,
    current_user: CurrentUserDep,
    session: SessionDep,
):
    key = normalize_item_key(body.item_key)
    if not key:
        raise HTTPException(
            status_code=400, detail="Missing grocery item. Refresh and try again."
        )

    if body.status is not None and body.status not in {
        GroceryItemStatus.dismissed.value,
        GroceryItemStatus.deleted.value,
        GroceryItemStatus.restored.value,
    }:
        raise HTTPException(
            status_code=400,
            detail="That grocery status isn’t valid. Refresh and try again.",
        )

    household, _ = require_membership(session, current_user)

    existing = session.exec(
        select(GroceryItemState).where(
            GroceryItemState.household_id == household.id,
            GroceryItemState.item_key == key,
        )
    ).first()

    if body.status is None:
        if existing:
            session.delete(existing)
            session.commit()
    else:
        status_value = GroceryItemStatus(body.status).value
        if existing:
            existing.status = status_value
            existing.created_by_id = current_user.id
            existing.updated_on = datetime.now(UTC)
            session.add(existing)
        else:
            session.add(
                GroceryItemState(
                    created_by_id=current_user.id,
                    household_id=household.id,
                    item_key=key,
                    status=status_value,
                    updated_on=datetime.now(UTC),
                )
            )
        session.commit()

    grocery = get_grocery_list(
        current_user=current_user, session=session, include_deleted=True
    )
    for item in grocery.items:
        if item.key == key:
            return item

    return GroceryItem(
        key=key,
        name=body.item_key.strip() or key,
        category="Other",
        quantities=[],
        quantity_display="",
        recipes=[],
        recipe_titles="",
        source_ingredient_ids=[],
        manual_item_ids=[],
        is_manual=False,
        dismissed=body.status == GroceryItemStatus.dismissed.value,
        auto_dismissed=False,
        deleted=body.status == GroceryItemStatus.deleted.value,
    )
