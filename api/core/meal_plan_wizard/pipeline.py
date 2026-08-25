"""Deterministic meal-plan wizard pipeline stages with progress events."""

from __future__ import annotations

import asyncio
import json
import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from typing import Any

from sqlmodel import select

from api.core.database import SessionDep
from api.core.household import ensure_user_household
from api.core.image_gen.client import ImageGenClient, get_image_gen_client
from api.core.image_gen.service import generate_recipe_cover_upload
from api.core.llm.client import ChatMessage, LlmClient, get_llm_client
from api.core.llm.tools import search_user_recipes
from api.core.logging import logger
from api.core.meal_plan_wizard.session_store import (
    ProgressEvent,
    WizardBuiltRecipe,
    WizardIdea,
    WizardPrefs,
    WizardSession,
    WizardStep,
)
from api.core.recipe_search import refresh_recipe_embedding
from api.core.recipe_text import normalize_instruction_newlines
from api.models import Ingredient, PlannedRecipe, Recipe, User


class MealPlanWizardPipeline:
    def __init__(
        self,
        llm: LlmClient | None = None,
        image_gen: ImageGenClient | None = None,
    ):
        self.llm = llm or get_llm_client()
        self.image_gen = image_gen or get_image_gen_client()

    def update_days(self, session: WizardSession, days: list[str]) -> WizardSession:
        cleaned = sorted({d.strip() for d in days if d.strip()})
        if not cleaned:
            raise ValueError("Select at least one day to plan.")
        if cleaned != session.days:
            session.days = cleaned
            self._clear_from(session, "ideate")
            session.step = "prefs"
        return session

    def update_prefs(self, session: WizardSession, prefs: WizardPrefs) -> WizardSession:
        changed = prefs != session.prefs
        session.prefs = prefs
        if changed and session.step not in ("days", "prefs"):
            # Changing constraints invalidates downstream LLM work
            self._clear_from(session, "ideate")
            session.step = "prefs"
        elif session.step == "days":
            session.step = "prefs"
        return session

    def rewind(self, session: WizardSession, to_step: WizardStep) -> WizardSession:
        order: list[WizardStep] = [
            "days",
            "prefs",
            "ideate",
            "select",
            "build",
            "review",
            "committed",
        ]
        if to_step not in order:
            raise ValueError(f"Unknown step: {to_step}")
        if to_step == "committed":
            raise ValueError("Cannot rewind to committed.")
        # Drop everything from the target stage forward.
        if to_step in ("days", "prefs", "ideate"):
            self._clear_from(session, "ideate")
        elif to_step == "select":
            # Keep ideas; drop selection + builds
            session.selected_idea_ids = []
            session.built_recipes = []
            session.build_messages = []
        elif to_step == "build":
            self._clear_from(session, "build")
        elif to_step == "review":
            if not session.built_recipes:
                raise ValueError("Nothing to review yet.")
        session.step = to_step
        return session

    def _clear_from(self, session: WizardSession, from_step: str) -> None:
        if from_step in ("ideate", "days", "prefs"):
            session.ideas = []
            session.selected_idea_ids = []
            session.built_recipes = []
            session.ideate_messages = []
            session.build_messages = []
            session.progress_log = []
        elif from_step == "select":
            session.selected_idea_ids = []
            session.built_recipes = []
            session.build_messages = []
        elif from_step == "build":
            session.built_recipes = []
            session.build_messages = []

    async def run_ideate(
        self,
        session: WizardSession,
        db: SessionDep,
        user: User,
        *,
        refinement: str | None = None,
    ) -> AsyncIterator[ProgressEvent]:
        n = session.day_count
        target = session.idea_target_count
        if n < 1:
            yield ProgressEvent(
                stage="ideate",
                status="error",
                message="No days selected.",
                progress=0,
            )
            return

        # Refinement continues the conversation; a fresh run resets it.
        if refinement and session.ideate_messages and session.ideas:
            session.ideate_messages.append(
                {
                    "role": "user",
                    "content": (
                        "Refine the previous idea list with this feedback:\n"
                        f"{refinement}\n"
                        f"Return exactly IDEATE_COUNT={target} ideas again.\n"
                        "Respond with ONLY valid JSON: "
                        '{"ideas":[{"title":"...","justification":"..."}]}'
                    ),
                }
            )
        else:
            self._clear_from(session, "ideate")
            library_preview = search_user_recipes(db, user, "", limit=12)
            system = (
                "You are a meal-planning assistant. Propose dinner ideas. "
                "Be deterministic and respect constraints. "
                "Prefer reusing the user's recipes when they fit. "
                "Respond with ONLY valid JSON (no markdown) matching:\n"
                '{"ideas":[{"title":"string","justification":"string"}]}\n'
                "Return exactly the requested number of ideas."
            )
            user_prompt = self._ideate_prompt(session, library_preview, target)
            session.ideate_messages = [
                {"role": "system", "content": system},
                {"role": "user", "content": user_prompt},
            ]

        yield self._log(
            session,
            "ideate",
            "running",
            "Reading your goals and pantry cues…",
            0.08,
        )
        await asyncio.sleep(0.35)

        yield self._log(
            session,
            "ideate",
            "running",
            f"Scanning {n} open nights for variety…",
            0.22,
        )
        await asyncio.sleep(0.4)

        library_hits = search_user_recipes(
            db,
            user,
            (session.prefs.preferred_ingredients or session.prefs.goals or "")[:40],
            limit=8,
        )
        yield self._log(
            session,
            "ideate",
            "running",
            (
                (
                    "Checked your recipe shelf — "
                    f"{len(library_hits)} familiar options nearby…"
                )
                if library_hits
                else "No close shelf matches yet — drafting fresh ideas…"
            ),
            0.45,
            {"library_hits": len(library_hits)},
        )
        await asyncio.sleep(0.45)

        yield self._log(
            session,
            "ideate",
            "running",
            f"Drafting {target} dinner concepts (need {n})…",
            0.68,
        )

        messages = [ChatMessage(**m) for m in session.ideate_messages]
        result = await self.llm.complete(messages, temperature=0.35)
        session.stubbed = result.stubbed
        parsed = result.parsed or {}
        raw_ideas = parsed.get("ideas") or []

        ideas: list[WizardIdea] = []
        for item in raw_ideas[:target]:
            ideas.append(
                WizardIdea(
                    id=str(uuid.uuid4()),
                    title=str(item.get("title") or "Untitled idea").strip(),
                    justification=str(item.get("justification") or "").strip(),
                )
            )
        # Pad if stub under-delivers
        while len(ideas) < target:
            ideas.append(
                WizardIdea(
                    id=str(uuid.uuid4()),
                    title=f"Flexible Bowl Option {len(ideas) + 1}",
                    justification="Extra slot to keep selection flexible.",
                )
            )

        session.ideas = ideas
        session.ideate_messages.append(
            {
                "role": "assistant",
                "content": json.dumps(
                    [
                        {"id": i.id, "title": i.title, "justification": i.justification}
                        for i in ideas
                    ]
                ),
            }
        )
        session.step = "select"
        session.selected_idea_ids = []
        session.built_recipes = []
        session.build_messages = []

        yield self._log(
            session,
            "ideate",
            "complete",
            f"Ready — {len(ideas)} ideas on the table. Pick {n}.",
            1.0,
            {
                "ideas": [
                    {"id": i.id, "title": i.title, "justification": i.justification}
                    for i in ideas
                ],
                "select_count": n,
                "stubbed": session.stubbed,
            },
        )

    def select_ideas(
        self, session: WizardSession, idea_ids: list[str]
    ) -> WizardSession:
        if not session.ideas:
            raise ValueError("Run ideation before selecting ideas.")
        wanted = session.day_count
        unique = []
        seen = set()
        valid = {i.id for i in session.ideas}
        for idea_id in idea_ids:
            if idea_id in valid and idea_id not in seen:
                unique.append(idea_id)
                seen.add(idea_id)
        if len(unique) != wanted:
            raise ValueError(f"Select exactly {wanted} ideas (got {len(unique)}).")
        if unique != session.selected_idea_ids:
            session.built_recipes = []
            session.build_messages = []
        session.selected_idea_ids = unique
        session.step = "build"
        return session

    async def run_freeform_build(
        self,
        session: WizardSession,
        db: SessionDep,
        user: User,
        *,
        prompt: str,
        refinement: str | None = None,
        idea_ids: list[str] | None = None,
    ) -> AsyncIterator[ProgressEvent]:
        """Build recipes directly from a single free-text prompt (skips ideate/select)."""
        n = session.day_count
        if n < 1:
            yield ProgressEvent(
                stage="build",
                status="error",
                message="No days selected.",
                progress=0,
            )
            return

        prompt = (prompt or "").strip()
        if not prompt:
            yield ProgressEvent(
                stage="build",
                status="error",
                message="Describe what you’d like to cook.",
                progress=0,
            )
            return
        if len(prompt) > 4000:
            yield ProgressEvent(
                stage="build",
                status="error",
                message="That description is too long. Keep it under 4000 characters.",
                progress=0,
            )
            return

        # Ensure synthetic ideas exist for each planned day (used for review/regen).
        if not session.ideas or len(session.ideas) != n:
            session.ideas = [
                WizardIdea(
                    id=str(uuid.uuid4()),
                    title=f"Dinner for {day}",
                    justification="From your description.",
                )
                for day in session.days
            ]
            session.selected_idea_ids = [i.id for i in session.ideas]
            session.built_recipes = []
            session.build_messages = []

        selected = [i for i in session.ideas if i.id in set(session.selected_idea_ids)]
        order = {iid: idx for idx, iid in enumerate(session.selected_idea_ids)}
        selected.sort(key=lambda i: order[i.id])

        partial = bool(
            refinement and session.build_messages and session.built_recipes and idea_ids
        )
        if refinement and session.build_messages and session.built_recipes:
            if idea_ids:
                wanted = set(idea_ids)
                targets = [i for i in selected if i.id in wanted]
                if not targets:
                    yield ProgressEvent(
                        stage="build",
                        status="error",
                        message="Pick at least one dinner to regenerate.",
                        progress=0,
                    )
                    return
            else:
                targets = list(selected)

            prior_plan = [
                {
                    "idea_id": r.idea_id,
                    "title": r.title,
                    "description": r.description,
                    "instructions": r.instructions,
                    "notes": r.notes,
                    "prep_time": r.prep_time,
                    "ingredients": r.ingredients,
                }
                for r in session.built_recipes
            ]
            session.build_messages.append(
                {
                    "role": "user",
                    "content": (
                        "BUILD_RECIPES_FREEFORM refine previous drafts. "
                        "Return ONLY the dinners listed below "
                        f"({len(targets)} recipe(s)); leave the rest unchanged.\n"
                        + "\n".join(f"- {i.title}" for i in targets)
                        + f"\n\nFeedback:\n{refinement}\n\n"
                        "Original request:\n"
                        f"{prompt}\n\n"
                        "Prior plan context (do not drop coherence with these):\n"
                        + json.dumps(prior_plan)
                        + "\n\nRespond with ONLY valid JSON: "
                        '{"recipes":[...]} for the dinners listed above.'
                    ),
                }
            )
            work_list = targets
        else:
            self._clear_from(session, "ideate")
            library_preview = search_user_recipes(db, user, "", limit=20)
            system = (
                "You build complete dinner recipes from a user's free-text request. "
                "Respect dietary restrictions implied in the request. "
                "Respond with ONLY valid JSON (no markdown) matching:\n"
                '{"recipes":[{'
                '"title":"string","description":"string",'
                '"instructions":"string","notes":"string|null",'
                '"prep_time":30,'
                '"ingredients":[{"name":"string","amount":1.0,'
                '"units":"string|null","details":"string|null"}],'
                '"source":"generated","existing_recipe_id":null'
                "}]}\n"
                'Use source "library" and set existing_recipe_id when reusing '
                'a library recipe; otherwise source "generated" and null id.\n'
                "For instructions: use numbered steps (1. 2. 3. …) with a real "
                "newline (\\n) between each step — never a single mashed paragraph."
            )
            title_lines = "\n".join(f"- {i.title}" for i in selected)
            user_prompt = (
                "BUILD_RECIPES_FREEFORM\n"
                f"Plan {n} dinner(s) for these days: {', '.join(session.days)}\n"
                f"User request:\n{prompt}\n\n"
                "Return exactly "
                f"{n} recipe object(s), one per day, in the same order.\n"
                "Return recipes for:\n"
                f"{title_lines}\n\n"
                "User library (may reuse by id when appropriate):\n"
                + json.dumps(library_preview)
                + "\n\nWrite instructions as numbered steps separated by newlines, e.g.\n"
                '"1. Heat the oil.\\n2. Add the onion.\\n3. Simmer 20 minutes."'
            )
            session.ideas = selected
            session.selected_idea_ids = [i.id for i in selected]
            session.build_messages = [
                {"role": "system", "content": system},
                {"role": "user", "content": user_prompt},
            ]
            work_list = selected
            partial = False

        total = len(work_list)
        yield self._log(
            session,
            "build",
            "running",
            "Reading your description…",
            0.1,
        )
        await asyncio.sleep(0.35)

        yield self._log(
            session,
            "build",
            "running",
            f"Drafting {total} dinner{'s' if total != 1 else ''}…",
            0.45,
        )
        await asyncio.sleep(0.4)

        messages = [ChatMessage(**m) for m in session.build_messages]
        result = await self.llm.complete(messages, temperature=0.35)
        session.stubbed = result.stubbed
        parsed = result.parsed or {}
        raw_recipes = parsed.get("recipes") or []

        def _build_one(idea: WizardIdea, raw: dict) -> WizardBuiltRecipe:
            existing_id = raw.get("existing_recipe_id")
            return WizardBuiltRecipe(
                idea_id=idea.id,
                title=str(raw.get("title") or idea.title).strip(),
                description=str(raw.get("description") or "").strip(),
                instructions=normalize_instruction_newlines(
                    str(raw.get("instructions") or "")
                ),
                notes=(
                    str(raw.get("notes")).strip()
                    if raw.get("notes") is not None
                    else None
                ),
                prep_time=(
                    float(raw["prep_time"])
                    if raw.get("prep_time") is not None
                    else None
                ),
                ingredients=list(raw.get("ingredients") or []),
                source=str(raw.get("source") or "generated"),
                existing_recipe_id=(
                    int(existing_id) if existing_id is not None else None
                ),
            )

        def _raw_for(idea: WizardIdea, index: int) -> dict:
            raw = raw_recipes[index] if index < len(raw_recipes) else {}
            for candidate in raw_recipes:
                if str(candidate.get("title", "")).lower() == idea.title.lower():
                    return candidate
            return raw

        if partial:
            by_idea = {r.idea_id: r for r in session.built_recipes}
            for idx, idea in enumerate(work_list):
                by_idea[idea.id] = _build_one(idea, _raw_for(idea, idx))
            built = [by_idea[i.id] for i in selected if i.id in by_idea]
            while len(built) < len(selected):
                missing = selected[len(built)]
                built.append(_build_one(missing, {}))
        else:
            built = [
                _build_one(idea, _raw_for(idea, idx))
                for idx, idea in enumerate(work_list)
            ]
            # Pad if stub under-delivers
            while len(built) < len(selected):
                missing = selected[len(built)]
                built.append(_build_one(missing, {}))

        session.built_recipes = built
        session.build_messages.append(
            {
                "role": "assistant",
                "content": json.dumps(
                    [
                        {
                            "idea_id": r.idea_id,
                            "title": r.title,
                            "description": r.description,
                            "instructions": r.instructions,
                            "notes": r.notes,
                            "prep_time": r.prep_time,
                            "ingredients": r.ingredients,
                        }
                        for r in built
                    ]
                ),
            }
        )
        session.step = "review"

        yield self._log(
            session,
            "build",
            "complete",
            (
                f"Updated {len(work_list)} dinner{'s' if len(work_list) != 1 else ''}."
                if refinement
                else f"Built {len(built)} dinner{'s' if len(built) != 1 else ''} — review your "
                f"{'week' if n > 1 else 'recipe'}."
            ),
            1.0,
            {
                "recipes": [self._serialize_built(r) for r in built],
                "regenerated_idea_ids": [i.id for i in work_list],
                "stubbed": session.stubbed,
            },
        )

    async def run_build(
        self,
        session: WizardSession,
        db: SessionDep,
        user: User,
        *,
        refinement: str | None = None,
        idea_ids: list[str] | None = None,
    ) -> AsyncIterator[ProgressEvent]:
        if len(session.selected_idea_ids) != session.day_count:
            yield ProgressEvent(
                stage="build",
                status="error",
                message="Select the required number of ideas first.",
                progress=0,
            )
            return

        selected = [i for i in session.ideas if i.id in set(session.selected_idea_ids)]
        # Preserve selection order
        order = {iid: idx for idx, iid in enumerate(session.selected_idea_ids)}
        selected.sort(key=lambda i: order[i.id])

        partial = bool(
            refinement and session.build_messages and session.built_recipes and idea_ids
        )
        if refinement and session.build_messages and session.built_recipes:
            if idea_ids:
                wanted = set(idea_ids)
                targets = [i for i in selected if i.id in wanted]
                if not targets:
                    yield ProgressEvent(
                        stage="build",
                        status="error",
                        message="Pick at least one dinner to regenerate.",
                        progress=0,
                    )
                    return
            else:
                targets = list(selected)

            prior_plan = [
                {
                    "idea_id": r.idea_id,
                    "title": r.title,
                    "description": r.description,
                    "instructions": r.instructions,
                    "notes": r.notes,
                    "prep_time": r.prep_time,
                    "ingredients": r.ingredients,
                }
                for r in session.built_recipes
            ]
            session.build_messages.append(
                {
                    "role": "user",
                    "content": (
                        "BUILD_RECIPES refine previous drafts. "
                        "Return ONLY the dinners listed below "
                        f"({len(targets)} recipe(s)); leave the rest unchanged.\n"
                        + "\n".join(f"- {i.title}" for i in targets)
                        + f"\n\nFeedback:\n{refinement}\n\n"
                        "Prior plan context (do not drop coherence with these):\n"
                        + json.dumps(prior_plan)
                        + "\n\nRespond with ONLY valid JSON: "
                        '{"recipes":[...]} for the dinners listed above.'
                    ),
                }
            )
            work_list = targets
        else:
            session.built_recipes = []
            library_preview = search_user_recipes(db, user, "", limit=20)
            system = (
                "You build complete dinner recipes or reuse existing ones. "
                "Respect dietary restrictions. "
                "Respond with ONLY valid JSON (no markdown) matching:\n"
                '{"recipes":[{'
                '"title":"string","description":"string",'
                '"instructions":"string","notes":"string|null",'
                '"prep_time":30,'
                '"ingredients":[{"name":"string","amount":1.0,'
                '"units":"string|null","details":"string|null"}],'
                '"source":"generated","existing_recipe_id":null'
                "}]}\n"
                'Use source "library" and set existing_recipe_id when reusing '
                'a library recipe; otherwise source "generated" and null id.\n'
                "For instructions: use numbered steps (1. 2. 3. …) with a real "
                "newline (\\n) between each step — never a single mashed paragraph."
            )
            user_prompt = (
                "BUILD_RECIPES for these selected ideas:\n"
                + "\n".join(f"- {i.title}" for i in selected)
                + "\n\nConstraints:\n"
                + self._prefs_block(session.prefs)
                + "\n\nUser library (may reuse by id later):\n"
                + json.dumps(library_preview)
                + "\n\nReturn one recipe object per selected idea, same titles.\n"
                "Write instructions as numbered steps separated by newlines, e.g.\n"
                '"1. Heat the oil.\\n2. Add the onion.\\n3. Simmer 20 minutes."'
            )
            session.build_messages = [
                {"role": "system", "content": system},
                {"role": "user", "content": user_prompt},
            ]
            work_list = selected
            partial = False

        total = len(work_list)
        yield self._log(
            session,
            "build",
            "running",
            (
                f"Refining {total} dinner{'s' if total != 1 else ''}…"
                if refinement
                else "Locking in your shortlist…"
            ),
            0.1,
        )
        await asyncio.sleep(0.3)

        for idx, idea in enumerate(work_list):
            frac = 0.15 + (0.55 * (idx / max(total, 1)))
            yield self._log(
                session,
                "build",
                "running",
                f"{'Revising' if refinement else 'Developing'} “{idea.title}”…",
                frac,
                {"current_title": idea.title, "index": idx, "total": total},
            )
            await asyncio.sleep(0.35)

        yield self._log(
            session,
            "build",
            "running",
            "Balancing ingredients across the week…",
            0.78,
        )

        messages = [ChatMessage(**m) for m in session.build_messages]
        result = await self.llm.complete(messages, temperature=0.3)
        session.stubbed = result.stubbed
        raw_recipes = (result.parsed or {}).get("recipes") or []

        def _build_one(idea: WizardIdea, raw: dict) -> WizardBuiltRecipe:
            existing_id = raw.get("existing_recipe_id")
            return WizardBuiltRecipe(
                idea_id=idea.id,
                title=str(raw.get("title") or idea.title),
                description=str(raw.get("description") or idea.justification),
                instructions=normalize_instruction_newlines(
                    str(
                        raw.get("instructions")
                        or "1. Prep ingredients.\n2. Cook.\n3. Serve."
                    )
                ),
                notes=raw.get("notes"),
                prep_time=(
                    float(raw["prep_time"])
                    if raw.get("prep_time") is not None
                    else None
                ),
                ingredients=list(raw.get("ingredients") or []),
                source=str(raw.get("source") or "generated"),
                existing_recipe_id=(
                    int(existing_id) if existing_id is not None else None
                ),
            )

        def _raw_for(idea: WizardIdea, index: int) -> dict:
            raw = raw_recipes[index] if index < len(raw_recipes) else {}
            for candidate in raw_recipes:
                if str(candidate.get("title", "")).lower() == idea.title.lower():
                    return candidate
            return raw

        if partial:
            by_idea = {r.idea_id: r for r in session.built_recipes}
            for idx, idea in enumerate(work_list):
                by_idea[idea.id] = _build_one(idea, _raw_for(idea, idx))
            built = [by_idea[i.id] for i in selected if i.id in by_idea]
            # Fill any gaps if a prior recipe was somehow missing
            while len(built) < len(selected):
                missing = selected[len(built)]
                built.append(_build_one(missing, {}))
        else:
            built = [
                _build_one(idea, _raw_for(idea, idx))
                for idx, idea in enumerate(work_list)
            ]

        session.built_recipes = built
        session.build_messages.append(
            {
                "role": "assistant",
                "content": json.dumps(
                    [
                        {
                            "idea_id": r.idea_id,
                            "title": r.title,
                            "description": r.description,
                            "instructions": r.instructions,
                            "notes": r.notes,
                            "prep_time": r.prep_time,
                            "ingredients": r.ingredients,
                        }
                        for r in built
                    ]
                ),
            }
        )
        session.step = "review"

        yield self._log(
            session,
            "build",
            "complete",
            (
                f"Updated {len(work_list)} dinner{'s' if len(work_list) != 1 else ''}."
                if refinement
                else f"Built {len(built)} dinners — review your week."
            ),
            1.0,
            {
                "recipes": [self._serialize_built(r) for r in built],
                "regenerated_idea_ids": [i.id for i in work_list],
                "stubbed": session.stubbed,
            },
        )

    def commit(
        self,
        session: WizardSession,
        db: SessionDep,
        user: User,
        *,
        day_assignments: list[dict[str, str]] | None = None,
        plan: bool = True,
    ) -> list[PlannedRecipe]:
        """Create recipes as needed and optionally plan them onto selected days.

        day_assignments: optional [{day, idea_id}] — defaults to zip order.
        plan: when False (ad-hoc generate), persist recipes only; no
        PlannedRecipe rows.
        """
        if session.step not in ("review", "build", "committed"):
            raise ValueError("Finish building recipes before committing.")
        if len(session.built_recipes) != session.day_count:
            raise ValueError("Built recipe count does not match selected days.")

        by_idea = {r.idea_id: r for r in session.built_recipes}
        if day_assignments:
            pairs: list[tuple[str, WizardBuiltRecipe]] = []
            for row in day_assignments:
                day = row["day"]
                idea_id = row["idea_id"]
                if day not in session.days:
                    raise ValueError(f"Day {day} is not part of this session.")
                recipe = by_idea.get(idea_id)
                if not recipe:
                    raise ValueError(f"Unknown idea_id {idea_id}")
                pairs.append((day, recipe))
            if len(pairs) != session.day_count:
                raise ValueError("Assign every selected day exactly once.")
        else:
            pairs = list(zip(session.days, session.built_recipes, strict=True))

        planned: list[PlannedRecipe] = []
        for day, built in pairs:
            recipe_id = built.existing_recipe_id or built.created_recipe_id
            if recipe_id is None:
                household = ensure_user_household(db, user)
                db_recipe = Recipe(
                    created_by_id=user.id,
                    household_id=household.id,
                    created_on=datetime.now(UTC),
                    name=built.title,
                    description=built.description,
                    instructions=built.instructions,
                    notes=built.notes,
                    public=False,
                    prep_time=built.prep_time,
                )
                db.add(db_recipe)
                db.commit()
                db.refresh(db_recipe)
                for ing in built.ingredients:
                    db_ing = Ingredient(
                        created_by_id=user.id,
                        created_on=datetime.now(UTC),
                        name=str(ing.get("name") or "ingredient"),
                        amount=ing.get("amount"),
                        units=ing.get("units"),
                        details=ing.get("details"),
                        recipe_id=db_recipe.id,
                    )
                    db.add(db_ing)
                db.commit()

                cover_id = self._maybe_attach_cover(db, user, built)
                if cover_id is not None:
                    db_recipe.cover_image_id = cover_id
                    db.add(db_recipe)
                    db.commit()
                    db.refresh(db_recipe)

                refresh_recipe_embedding(db, db_recipe, commit=True)

                recipe_id = db_recipe.id
                built.created_recipe_id = recipe_id
                built.source = "generated"

            if not plan:
                continue

            # Store noon UTC so local-day keys stay stable across common offsets.
            day_start = datetime.fromisoformat(f"{day}T00:00:00").replace(tzinfo=UTC)
            day_end = datetime.fromisoformat(f"{day}T23:59:59.999999").replace(
                tzinfo=UTC
            )
            planned_for = datetime.fromisoformat(f"{day}T12:00:00").replace(tzinfo=UTC)
            household = ensure_user_household(db, user)
            # Replace any existing plan for that day in the household (one dinner slot)
            existing = db.exec(
                select(PlannedRecipe).where(
                    PlannedRecipe.household_id == household.id,
                    PlannedRecipe.planned_for >= day_start,
                    PlannedRecipe.planned_for <= day_end,
                )
            ).all()
            for old in existing:
                db.delete(old)
            pr = PlannedRecipe(
                recipe_id=recipe_id,
                created_by_id=user.id,
                household_id=household.id,
                created_on=datetime.now(UTC),
                planned_for=planned_for,
            )
            db.add(pr)
            db.commit()
            db.refresh(pr)
            planned.append(pr)

        session.step = "committed"
        return planned

    def _maybe_attach_cover(
        self,
        db: SessionDep,
        user: User,
        built: WizardBuiltRecipe,
    ) -> int | None:
        """Best-effort cover image via the configured provider. Never fails commit."""
        try:
            upload = generate_recipe_cover_upload(
                user=user,
                db=db,
                title=built.title,
                description=built.description,
                ingredients=built.ingredients,
                image_gen=self.image_gen,
            )
            return upload.id if upload else None
        except Exception as exc:  # noqa: BLE001 — cover art must not block planning
            logger.warning("Cover image generation failed for %r: %s", built.title, exc)
            return None

    def _ideate_prompt(
        self,
        session: WizardSession,
        library_preview: list[dict[str, Any]],
        target: int,
    ) -> str:
        return (
            f"IDEATE_COUNT={target}\n"
            f"Plan dinners for these days: {', '.join(session.days)}\n"
            f"Need {session.day_count} final picks; propose {target} options.\n\n"
            f"Constraints:\n{self._prefs_block(session.prefs)}\n\n"
            f"User recipe library sample:\n{json.dumps(library_preview)}\n"
        )

    def _prefs_block(self, prefs: WizardPrefs) -> str:
        lines = [
            f"- Goals: {prefs.goals or '(none)'}",
            f"- Dietary restrictions: {prefs.dietary_restrictions or '(none)'}",
            f"- Preferred ingredients: {prefs.preferred_ingredients or '(none)'}",
            f"- Max cook minutes: {prefs.max_cook_minutes or '(none)'}",
            f"- Servings: {prefs.servings or '(none)'}",
            f"- Cuisine notes: {prefs.cuisine_notes or '(none)'}",
            f"- Extra notes: {prefs.extra_notes or '(none)'}",
        ]
        return "\n".join(lines)

    def _log(
        self,
        session: WizardSession,
        stage: str,
        status: str,
        message: str,
        progress: float,
        data: dict[str, Any] | None = None,
    ) -> ProgressEvent:
        event = ProgressEvent(
            stage=stage,
            status=status,  # type: ignore[arg-type]
            message=message,
            progress=progress,
            data=data,
        )
        session.progress_log.append(event)
        return event

    @staticmethod
    def _serialize_built(r: WizardBuiltRecipe) -> dict[str, Any]:
        return {
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
