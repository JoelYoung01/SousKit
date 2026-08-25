from datetime import datetime

from pydantic import BaseModel, EmailStr, Field, computed_field, field_validator

from api.core.recipe_text import normalize_instruction_newlines


class HealthResponse(BaseModel):
    status: str
    version: str


class MigrationUpgradeResponse(BaseModel):
    previous_revision: str | None
    current_revision: str | None
    head_revision: str | None
    upgraded: bool
    message: str


class UserResponse(BaseModel):
    id: int
    username: str
    email: str
    display_name: str
    admin: bool
    disabled: bool
    email_verified: bool = False
    avatar_url: str | None = None
    last_login: datetime | None = None


class UserPublic(BaseModel):
    id: int
    display_name: str
    avatar_url: str | None = None


class GoogleLoginPayload(BaseModel):
    credential: str


class AppleLoginPayload(BaseModel):
    identity_token: str
    # Apple shares the user's name only on FIRST authorization, and only with
    # the client — it is never inside the identity token.
    full_name: str | None = None


class RegisterPayload(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=1024)
    display_name: str = Field(min_length=1, max_length=100)


class PasswordLoginPayload(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=1024)


class VerifyEmailPayload(BaseModel):
    email: EmailStr
    otp: str = Field(min_length=4, max_length=12)


class ResendVerificationPayload(BaseModel):
    email: EmailStr


class AuthRedirectResponse(BaseModel):
    """Server-directed next step for the SPA (e.g. email verification)."""

    code: str
    message: str
    redirect_to: str
    email: str | None = None
    # Only populated when ENVIRONMENT=development so local testing can skip SMTP.
    dev_otp: str | None = None


class TokenResponse(BaseModel):
    access_token: str
    user: UserResponse


class UploadFileResponse(BaseModel):
    id: int
    name: str
    file_path: str
    created_on: datetime
    created_by_id: int

    @computed_field
    @property
    def url(self) -> str:
        return f"/uploads/{self.file_path}"


class RecipeCoverIngredientHint(BaseModel):
    name: str | None = None


class RecipeCoverGenerateRequest(BaseModel):
    """Fields used to search/generate a cover; works before a recipe is saved."""

    name: str = Field(min_length=1)
    description: str | None = None
    ingredients: list[RecipeCoverIngredientHint] = Field(default_factory=list)


class RecipeSlim(BaseModel):
    id: int
    name: str
    description: str
    instructions: str
    notes: str | None = None
    created_on: datetime
    created_by_id: int
    household_id: int
    public: bool
    prep_time: float | None = None
    cover_image_id: int | None = None

    @field_validator("instructions")
    @classmethod
    def _normalize_instructions(cls, value: str) -> str:
        return normalize_instruction_newlines(value)


class RecipeDetail(RecipeSlim):
    created_by: "UserResponse"
    ingredients: list["IngredientDetail"]
    cover_image: UploadFileResponse | None


class RecipeDashboard(RecipeSlim):
    cover_image: UploadFileResponse | None


class RecipeCard(BaseModel):
    """List/card payload — omits instructions/notes for faster first paint."""

    id: int
    name: str
    description: str
    created_on: datetime
    created_by_id: int
    household_id: int
    public: bool
    prep_time: float | None = None
    cover_image_id: int | None = None
    cover_image: UploadFileResponse | None = None


class CountResponse(BaseModel):
    count: int


class RecipeCreate(BaseModel):
    name: str
    description: str
    instructions: str
    notes: str | None = None
    public: bool
    prep_time: float | None = None
    cover_image_id: int | None = None

    @field_validator("instructions")
    @classmethod
    def _normalize_instructions(cls, value: str) -> str:
        return normalize_instruction_newlines(value)


class RecipeImportFromUrlRequest(BaseModel):
    """Paste a public recipe-page URL; server fetches and extracts a recipe."""

    url: str = Field(min_length=1, max_length=2048)


class RecipeAiEditRequest(BaseModel):
    """Free-text instruction for LLM-assisted recipe editing."""

    instruction: str = Field(min_length=1, max_length=4000)


class RecipeUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    instructions: str | None = None
    notes: str | None = None
    public: bool | None = None
    prep_time: float | None = None
    cover_image_id: int | None = None

    @field_validator("instructions")
    @classmethod
    def _normalize_instructions(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return normalize_instruction_newlines(value)


class TimeFrameRequest(BaseModel):
    start: datetime
    end: datetime


class PlannedRecipeSlim(BaseModel):
    id: int
    created_by_id: int
    household_id: int
    created_on: datetime
    planned_for: datetime


class PlannedRecipeDetail(PlannedRecipeSlim):
    created_by: "UserResponse"
    recipe: "RecipeCard"


class PlannedRecipeCreate(BaseModel):
    recipe_id: int
    planned_for: str


class PlannedRecipeUpdate(BaseModel):
    recipe_id: int | None = None
    planned_for: str | None = None


class IngredientSlim(BaseModel):
    id: int
    name: str
    amount: float | None = None
    units: str | None = None
    details: str | None = None


class IngredientDetail(IngredientSlim):
    recipe: "RecipeSlim"


class IngredientCreate(BaseModel):
    name: str
    amount: float | None = None
    units: str | None = None
    details: str | None = None
    recipe_id: int


class IngredientUpdate(BaseModel):
    name: str | None = None
    amount: float | None = None
    units: str | None = None
    details: str | None = None


class UserUpdate(BaseModel):
    display_name: str | None = None


class GroceryQuantity(BaseModel):
    amount: float | None = None
    units: str | None = None


class GroceryRecipeRef(BaseModel):
    id: int
    name: str


class GroceryItem(BaseModel):
    key: str
    name: str
    category: str
    quantities: list[GroceryQuantity]
    quantity_display: str
    recipes: list[GroceryRecipeRef]
    recipe_titles: str
    source_ingredient_ids: list[int]
    manual_item_ids: list[int] = []
    is_manual: bool = False
    auto_dismissed: bool = False
    dismissed: bool = False
    deleted: bool = False


class GroceryListResponse(BaseModel):
    window_start: datetime
    window_end: datetime
    items: list[GroceryItem]


class GrocerySummaryResponse(BaseModel):
    window_start: datetime
    window_end: datetime
    active_count: int


class GroceryItemStateUpdate(BaseModel):
    item_key: str
    status: str | None = None  # "dismissed" | "deleted" | "restored" | null to clear


class GroceryManualItemCreate(BaseModel):
    name: str
    amount: float | None = None
    units: str | None = None


# --- Household ---


class HouseholdMemberResponse(BaseModel):
    user_id: int
    role: str
    joined_on: datetime
    display_name: str
    email: str
    avatar_url: str | None = None


class HouseholdInviteResponse(BaseModel):
    id: int
    email: str | None = None
    status: str
    created_on: datetime
    expires_on: datetime
    invited_by_id: int
    # Returned to the owner so they can share the join link / QR out-of-band.
    token: str | None = None
    invite_url: str | None = None


class HouseholdResponse(BaseModel):
    id: int
    name: str
    created_by_id: int
    created_on: datetime
    my_role: str
    member_count: int
    max_members: int
    members: list[HouseholdMemberResponse]
    pending_invites: list[HouseholdInviteResponse] = Field(default_factory=list)


class HouseholdUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=80)


class HouseholdInviteAccept(BaseModel):
    token: str = Field(min_length=8, max_length=128)


class PendingHouseholdInviteResponse(BaseModel):
    """Legacy invite addressed to the current user's email (for accept UI)."""

    id: int
    household_id: int
    household_name: str
    invited_by_name: str
    token: str
    invite_url: str | None = None
    created_on: datetime
    expires_on: datetime


# --- Meal plan wizard ---


class MealPlanWizardPrefs(BaseModel):
    goals: str = ""
    dietary_restrictions: str = ""
    preferred_ingredients: str = ""
    max_cook_minutes: int | None = None
    servings: int | None = None
    cuisine_notes: str = ""
    extra_notes: str = ""


class MealPlanWizardCreate(BaseModel):
    days: list[str] = Field(min_length=1)
    prefs: MealPlanWizardPrefs | None = None


class MealPlanWizardDaysUpdate(BaseModel):
    days: list[str] = Field(min_length=1)


class MealPlanWizardIdea(BaseModel):
    id: str
    title: str
    justification: str = ""


class MealPlanWizardBuiltRecipe(BaseModel):
    idea_id: str
    title: str
    description: str
    instructions: str
    notes: str | None = None
    prep_time: float | None = None
    ingredients: list[dict] = Field(default_factory=list)
    source: str = "generated"
    existing_recipe_id: int | None = None
    created_recipe_id: int | None = None

    @field_validator("instructions")
    @classmethod
    def _normalize_instructions(cls, value: str) -> str:
        return normalize_instruction_newlines(value)


class MealPlanWizardProgressEvent(BaseModel):
    stage: str
    status: str
    message: str
    progress: float
    data: dict | None = None


class MealPlanWizardSessionResponse(BaseModel):
    id: str
    days: list[str]
    prefs: MealPlanWizardPrefs
    step: str
    idea_target_count: int
    select_count: int
    ideas: list[MealPlanWizardIdea]
    selected_idea_ids: list[str]
    built_recipes: list[MealPlanWizardBuiltRecipe]
    progress_log: list[MealPlanWizardProgressEvent]
    stubbed: bool = True


class MealPlanWizardSelectRequest(BaseModel):
    idea_ids: list[str]


class MealPlanWizardRefineRequest(BaseModel):
    refinement: str | None = None
    """Optional idea ids to regenerate on a refine turn. Omit to rebuild all."""
    idea_ids: list[str] | None = None


class MealPlanWizardRewindRequest(BaseModel):
    to_step: str


class MealPlanWizardDayAssignment(BaseModel):
    day: str
    idea_id: str


class MealPlanWizardCommitRequest(BaseModel):
    assignments: list[MealPlanWizardDayAssignment] | None = None
    # When False, persist generated recipes but do not create planned_recipe rows.
    plan: bool = True
