"""In-memory wizard session store (fine for stub/dev; swap for Redis/DB later)."""

from __future__ import annotations

import threading
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any, Literal

WizardStep = Literal[
    "days",
    "prefs",
    "ideate",
    "select",
    "build",
    "review",
    "committed",
]


@dataclass
class WizardIdea:
    id: str
    title: str
    justification: str


@dataclass
class WizardBuiltRecipe:
    idea_id: str
    title: str
    description: str
    instructions: str
    notes: str | None
    prep_time: float | None
    ingredients: list[dict[str, Any]]
    source: str  # "generated" | "existing"
    existing_recipe_id: int | None = None
    created_recipe_id: int | None = None


@dataclass
class WizardPrefs:
    goals: str = ""
    dietary_restrictions: str = ""
    preferred_ingredients: str = ""
    max_cook_minutes: int | None = None
    servings: int | None = None
    cuisine_notes: str = ""
    extra_notes: str = ""


@dataclass
class ProgressEvent:
    stage: str
    status: Literal["running", "complete", "error"]
    message: str
    progress: float
    data: dict[str, Any] | None = None


@dataclass
class WizardSession:
    id: str
    user_id: int
    days: list[str]  # YYYY-MM-DD
    prefs: WizardPrefs
    step: WizardStep = "prefs"
    ideas: list[WizardIdea] = field(default_factory=list)
    selected_idea_ids: list[str] = field(default_factory=list)
    built_recipes: list[WizardBuiltRecipe] = field(default_factory=list)
    # Conversation history per LLM phase (for refinement, not full restarts)
    ideate_messages: list[dict[str, str]] = field(default_factory=list)
    build_messages: list[dict[str, str]] = field(default_factory=list)
    progress_log: list[ProgressEvent] = field(default_factory=list)
    created_at: datetime = field(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime = field(default_factory=lambda: datetime.now(UTC))
    stubbed: bool = True

    @property
    def day_count(self) -> int:
        return len(self.days)

    @property
    def idea_target_count(self) -> int:
        if self.day_count == 1:
            return 3
        return self.day_count + 5


class WizardSessionStore:
    def __init__(self) -> None:
        self._sessions: dict[str, WizardSession] = {}
        self._lock = threading.Lock()

    def create(
        self,
        user_id: int,
        days: list[str],
        prefs: WizardPrefs | None = None,
    ) -> WizardSession:
        # Reflect the configured client up front so the UI does not flash
        # "Stub LLM" while a live OpenRouter turn is still in flight.
        from api.core.llm.client import StubLlmClient, get_llm_client

        session = WizardSession(
            id=str(uuid.uuid4()),
            user_id=user_id,
            days=sorted(set(days)),
            prefs=prefs or WizardPrefs(),
            step="prefs",
            stubbed=isinstance(get_llm_client(), StubLlmClient),
        )
        with self._lock:
            self._sessions[session.id] = session
        return session

    def get(self, session_id: str, user_id: int) -> WizardSession | None:
        with self._lock:
            session = self._sessions.get(session_id)
        if not session or session.user_id != user_id:
            return None
        return session

    def touch(self, session: WizardSession) -> None:
        session.updated_at = datetime.now(UTC)

    def delete(self, session_id: str, user_id: int) -> bool:
        with self._lock:
            session = self._sessions.get(session_id)
            if not session or session.user_id != user_id:
                return False
            del self._sessions[session_id]
            return True


wizard_sessions = WizardSessionStore()
