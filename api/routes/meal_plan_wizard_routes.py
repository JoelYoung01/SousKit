"""HTTP API for the fill-gaps / plan-this-week wizard pipeline."""

from __future__ import annotations

import json
import logging
from collections.abc import AsyncIterator

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlmodel import Session

from api.core.authentication import CurrentUserDep, verify_access_token
from api.core.database import SessionDep, engine
from api.core.meal_plan_wizard.pipeline import MealPlanWizardPipeline
from api.core.meal_plan_wizard.session_store import (
    ProgressEvent,
    WizardPrefs,
    WizardSession,
    wizard_sessions,
)
from api.schemas import (
    MealPlanWizardCommitRequest,
    MealPlanWizardCreate,
    MealPlanWizardDaysUpdate,
    MealPlanWizardFreeformBuildRequest,
    MealPlanWizardPrefs,
    MealPlanWizardRefineRequest,
    MealPlanWizardRewindRequest,
    MealPlanWizardSelectRequest,
    MealPlanWizardSessionResponse,
    PlannedRecipeDetail,
)

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/meal-plan-wizard",
    dependencies=[Depends(verify_access_token)],
    tags=["Meal Plan Wizard"],
)

pipeline = MealPlanWizardPipeline()


def _prefs_from_schema(prefs: MealPlanWizardPrefs | None) -> WizardPrefs:
    if not prefs:
        return WizardPrefs()
    return WizardPrefs(**prefs.model_dump())


def _serialize(session: WizardSession) -> MealPlanWizardSessionResponse:
    return MealPlanWizardSessionResponse(
        id=session.id,
        days=session.days,
        prefs=MealPlanWizardPrefs(**session.prefs.__dict__),
        step=session.step,
        idea_target_count=session.idea_target_count,
        select_count=session.day_count,
        ideas=[
            {
                "id": i.id,
                "title": i.title,
                "justification": i.justification,
            }
            for i in session.ideas
        ],
        selected_idea_ids=session.selected_idea_ids,
        built_recipes=[
            {
                "idea_id": r.idea_id,
                "title": r.title,
                "description": r.description,
                "instructions": r.instructions,
                "notes": r.notes,
                "prep_time": r.prep_time,
                "ingredients": r.ingredients,
                "source": r.source,
                "existing_recipe_id": r.existing_recipe_id,
                "created_recipe_id": r.created_recipe_id,
            }
            for r in session.built_recipes
        ],
        progress_log=[
            {
                "stage": e.stage,
                "status": e.status,
                "message": e.message,
                "progress": e.progress,
                "data": e.data,
            }
            for e in session.progress_log
        ],
        stubbed=session.stubbed,
    )


def _get_owned_session(session_id: str, user_id: int) -> WizardSession:
    session = wizard_sessions.get(session_id, user_id)
    if not session:
        raise HTTPException(
            status_code=404,
            detail="That meal-plan session couldn’t be found. Start a new plan.",
        )
    return session


@router.post("/sessions/", response_model=MealPlanWizardSessionResponse)
def create_session(
    body: MealPlanWizardCreate,
    current_user: CurrentUserDep,
):
    session = wizard_sessions.create(
        user_id=current_user.id,
        days=body.days,
        prefs=_prefs_from_schema(body.prefs),
    )
    session.step = "prefs"
    return _serialize(session)


@router.get("/sessions/{session_id}/", response_model=MealPlanWizardSessionResponse)
def get_session(session_id: str, current_user: CurrentUserDep):
    return _serialize(_get_owned_session(session_id, current_user.id))


@router.patch(
    "/sessions/{session_id}/days/", response_model=MealPlanWizardSessionResponse
)
def update_days(
    session_id: str,
    body: MealPlanWizardDaysUpdate,
    current_user: CurrentUserDep,
):
    session = _get_owned_session(session_id, current_user.id)
    try:
        pipeline.update_days(session, body.days)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    wizard_sessions.touch(session)
    return _serialize(session)


@router.patch(
    "/sessions/{session_id}/prefs/", response_model=MealPlanWizardSessionResponse
)
def update_prefs(
    session_id: str,
    body: MealPlanWizardPrefs,
    current_user: CurrentUserDep,
):
    session = _get_owned_session(session_id, current_user.id)
    pipeline.update_prefs(session, _prefs_from_schema(body))
    wizard_sessions.touch(session)
    return _serialize(session)


@router.post(
    "/sessions/{session_id}/rewind/", response_model=MealPlanWizardSessionResponse
)
def rewind_session(
    session_id: str,
    body: MealPlanWizardRewindRequest,
    current_user: CurrentUserDep,
):
    session = _get_owned_session(session_id, current_user.id)
    try:
        pipeline.rewind(session, body.to_step)  # type: ignore[arg-type]
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    wizard_sessions.touch(session)
    return _serialize(session)


@router.post(
    "/sessions/{session_id}/select/", response_model=MealPlanWizardSessionResponse
)
def select_ideas(
    session_id: str,
    body: MealPlanWizardSelectRequest,
    current_user: CurrentUserDep,
):
    session = _get_owned_session(session_id, current_user.id)
    try:
        pipeline.select_ideas(session, body.idea_ids)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    wizard_sessions.touch(session)
    return _serialize(session)


async def _sse(events: AsyncIterator) -> AsyncIterator[bytes]:
    async for event in events:
        payload = {
            "stage": event.stage,
            "status": event.status,
            "message": event.message,
            "progress": event.progress,
            "data": event.data,
        }
        yield f"data: {json.dumps(payload)}\n\n".encode()
    yield b'data: {"status": "done"}\n\n'


@router.post("/sessions/{session_id}/ideate/")
async def ideate(
    session_id: str,
    current_user: CurrentUserDep,
    body: MealPlanWizardRefineRequest | None = None,
):
    session = _get_owned_session(session_id, current_user.id)
    refinement = body.refinement if body else None

    async def gen():
        # Own a session for the stream lifetime (request SessionDep may close early).
        try:
            with Session(engine) as db:
                async for event in pipeline.run_ideate(
                    session, db, current_user, refinement=refinement
                ):
                    wizard_sessions.touch(session)
                    yield event
        except Exception as exc:
            logger.exception("meal-plan wizard ideate failed for %s", session_id)
            yield ProgressEvent(
                stage="ideate",
                status="error",
                message=str(exc) or "Ideation failed.",
                progress=0,
            )

    return StreamingResponse(_sse(gen()), media_type="text/event-stream")


@router.post("/sessions/{session_id}/build/")
async def build(
    session_id: str,
    current_user: CurrentUserDep,
    body: MealPlanWizardRefineRequest | None = None,
):
    session = _get_owned_session(session_id, current_user.id)
    refinement = body.refinement if body else None
    idea_ids = body.idea_ids if body else None

    async def gen():
        try:
            with Session(engine) as db:
                async for event in pipeline.run_build(
                    session,
                    db,
                    current_user,
                    refinement=refinement,
                    idea_ids=idea_ids,
                ):
                    wizard_sessions.touch(session)
                    yield event
        except Exception as exc:
            logger.exception("meal-plan wizard build failed for %s", session_id)
            yield ProgressEvent(
                stage="build",
                status="error",
                message=str(exc) or "Recipe build failed.",
                progress=0,
            )

    return StreamingResponse(_sse(gen()), media_type="text/event-stream")


@router.post("/sessions/{session_id}/build-freeform/")
async def build_freeform(
    session_id: str,
    current_user: CurrentUserDep,
    body: MealPlanWizardFreeformBuildRequest,
):
    session = _get_owned_session(session_id, current_user.id)

    async def gen():
        try:
            with Session(engine) as db:
                async for event in pipeline.run_freeform_build(
                    session,
                    db,
                    current_user,
                    prompt=body.prompt,
                    refinement=body.refinement,
                    idea_ids=body.idea_ids,
                ):
                    wizard_sessions.touch(session)
                    yield event
        except Exception as exc:
            logger.exception("meal-plan wizard freeform build failed for %s", session_id)
            yield ProgressEvent(
                stage="build",
                status="error",
                message=str(exc) or "Recipe build failed.",
                progress=0,
            )

    return StreamingResponse(_sse(gen()), media_type="text/event-stream")


@router.post(
    "/sessions/{session_id}/commit/",
    response_model=list[PlannedRecipeDetail],
)
def commit_session(
    session_id: str,
    current_user: CurrentUserDep,
    db: SessionDep,
    body: MealPlanWizardCommitRequest | None = None,
):
    session = _get_owned_session(session_id, current_user.id)
    assignments = None
    plan = True
    if body:
        if body.assignments:
            assignments = [a.model_dump() for a in body.assignments]
        plan = body.plan
    try:
        planned = pipeline.commit(
            session, db, current_user, day_assignments=assignments, plan=plan
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    wizard_sessions.touch(session)
    return planned
