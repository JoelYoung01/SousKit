from datetime import datetime, timezone
from enum import Enum
from typing import Optional

from sqlalchemy import MetaData, UniqueConstraint
from sqlmodel import Field, Relationship, SQLModel

from api.core.timezone_handler import UTCDateTime


# Create common Base to be used by all models
class BaseDbModel(SQLModel):
    metadata = MetaData(
        naming_convention={
            "ix": "ix_%(column_0_label)s",
            "uq": "uq_%(table_name)s_%(column_0_name)s",
            "ck": "ck_%(table_name)s_`%(constraint_name)s`",
            "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
            "pk": "pk_%(table_name)s",
        }
    )

    __abstract__ = True


class BaseIndexedDbModel(BaseDbModel):
    __abstract__ = True
    id: int | None = Field(default=None, index=True, primary_key=True)


class User_Permission(BaseDbModel, table=True):
    user_id: int = Field(default=None, foreign_key="user.id", primary_key=True)
    permission_id: int = Field(
        default=None, foreign_key="permission.id", primary_key=True
    )


class User(BaseIndexedDbModel, table=True):
    avatar_url: str | None = None
    username: str
    email: str = Field(index=True, unique=True)
    display_name: str
    admin: bool = False
    disabled: bool = False
    email_verified: bool = False
    hashed_password: str | None = None
    google_user_id: str | None = Field(default=None, index=True)
    apple_user_id: str | None = Field(default=None, index=True)
    last_login: datetime | None = Field(
        default_factory=lambda: datetime.now(tz=timezone.utc), sa_type=UTCDateTime
    )

    tokens: list["Token"] = Relationship(back_populates="user")
    permissions: list["Permission"] = Relationship(link_model=User_Permission)
    email_verification: Optional["EmailVerificationChallenge"] = Relationship(
        back_populates="user",
        sa_relationship_kwargs={"uselist": False, "cascade": "all, delete-orphan"},
    )


class EmailVerificationChallenge(BaseIndexedDbModel, table=True):
    """Hashed one-time code used to verify a password user's email."""

    user_id: int = Field(foreign_key="user.id", unique=True)
    otp_hash: str
    expires_at: datetime = Field(sa_type=UTCDateTime)
    attempts: int = 0
    last_sent_at: datetime = Field(
        default_factory=lambda: datetime.now(tz=timezone.utc), sa_type=UTCDateTime
    )

    user: User = Relationship(back_populates="email_verification")


class TokenType(Enum):
    Access = 10


class Token(BaseIndexedDbModel, table=True):
    user_id: int = Field(foreign_key="user.id")
    access_token: str
    token_type: TokenType

    user: "User" = Relationship(back_populates="tokens")


class Permission(BaseIndexedDbModel, table=True):
    name: str


class Upload(BaseIndexedDbModel, table=True):
    created_by_id: int = Field(foreign_key="user.id")
    created_on: datetime = Field(sa_type=UTCDateTime)
    file_path: str
    name: str

    created_by: "User" = Relationship()


class Recipe(BaseIndexedDbModel, table=True):
    """Stable recipe identity. Cooked content lives on ``RecipeVersion`` rows.

    ``current_version_id`` points at the head of an append-only linear history.
    Reads of name, ingredients, and the other content fields resolve that head.
    """

    slug: str = Field(max_length=180, unique=True, index=True)
    created_by_id: int = Field(foreign_key="user.id")
    household_id: int = Field(foreign_key="household.id", index=True)
    created_on: datetime = Field(sa_type=UTCDateTime)
    public: bool = False
    # Integer pointer, not a DB foreign key, so a recipe row can be inserted
    # before its first version exists. Application code always sets it.
    current_version_id: int | None = Field(default=None, index=True)
    # JSON float array + model id for hybrid semantic search (not exposed in API DTOs).
    embedding_json: str | None = None
    embedding_model: str | None = Field(default=None, max_length=120)

    created_by: "User" = Relationship()
    household: "Household" = Relationship()
    versions: list["RecipeVersion"] = Relationship(
        back_populates="recipe",
        cascade_delete=True,
        sa_relationship_kwargs={
            "foreign_keys": "RecipeVersion.recipe_id",
            "order_by": "RecipeVersion.version_number",
            "overlaps": "current_version",
        },
    )
    current_version: Optional["RecipeVersion"] = Relationship(
        sa_relationship_kwargs={
            "primaryjoin": "foreign(Recipe.current_version_id) == RecipeVersion.id",
            "viewonly": True,
            "uselist": False,
            "overlaps": "versions",
        },
    )
    planned: list["PlannedRecipe"] = Relationship(
        back_populates="recipe",
        cascade_delete=True,
    )

    @property
    def _head(self) -> Optional["RecipeVersion"]:
        return self.current_version

    @property
    def name(self) -> str:
        head = self._head
        return head.name if head is not None else ""

    @property
    def description(self) -> str:
        head = self._head
        return head.description if head is not None else ""

    @property
    def instructions(self) -> str:
        head = self._head
        return head.instructions if head is not None else ""

    @property
    def notes(self) -> str | None:
        head = self._head
        return head.notes if head is not None else None

    @property
    def prep_time(self) -> float | None:
        head = self._head
        return head.prep_time if head is not None else None

    @property
    def cover_image_id(self) -> int | None:
        head = self._head
        return head.cover_image_id if head is not None else None

    @property
    def cover_image(self) -> Optional["Upload"]:
        head = self._head
        return head.cover_image if head is not None else None

    @property
    def ingredients(self) -> list["Ingredient"]:
        head = self._head
        if head is None:
            return []
        return list(head.ingredients or [])

    @property
    def head_version_number(self) -> int:
        head = self._head
        return head.version_number if head is not None else 0

    @property
    def updated_on(self) -> datetime:
        head = self._head
        return head.created_on if head is not None else self.created_on


class RecipeVersion(BaseIndexedDbModel, table=True):
    """One saved snapshot in a recipe's append-only history."""

    __tablename__ = "recipe_version"
    __table_args__ = (
        UniqueConstraint(
            "recipe_id",
            "version_number",
            name="uq_recipe_version_recipe_id_version_number",
        ),
    )

    recipe_id: int = Field(foreign_key="recipe.id", index=True)
    version_number: int
    created_on: datetime = Field(sa_type=UTCDateTime)
    created_by_id: int = Field(foreign_key="user.id")
    name: str
    description: str
    instructions: str
    notes: str | None = None
    prep_time: float | None = None
    cover_image_id: int | None = Field(default=None, foreign_key="upload.id")
    # create | edit | ai_edit | import | restore
    change_kind: str = Field(max_length=32)
    restored_from_version: int | None = None

    recipe: Recipe = Relationship(
        back_populates="versions",
        sa_relationship_kwargs={
            "foreign_keys": "RecipeVersion.recipe_id",
            "overlaps": "current_version",
        },
    )
    created_by: "User" = Relationship()
    cover_image: Optional["Upload"] = Relationship()
    ingredients: list["Ingredient"] = Relationship(
        back_populates="recipe_version",
        cascade_delete=True,
    )


class Ingredient(BaseIndexedDbModel, table=True):
    created_by_id: int = Field(foreign_key="user.id")
    created_on: datetime = Field(sa_type=UTCDateTime)
    name: str
    amount: float | None = None
    units: str | None = None
    details: str | None = None
    recipe_version_id: int = Field(foreign_key="recipe_version.id", index=True)

    recipe_version: "RecipeVersion" = Relationship(back_populates="ingredients")
    created_by: "User" = Relationship()

    @property
    def recipe(self) -> Recipe | None:
        version = self.recipe_version
        if version is None:
            return None
        return version.recipe


class PlannedRecipe(BaseIndexedDbModel, table=True):
    recipe_id: int = Field(foreign_key="recipe.id")
    created_by_id: int = Field(foreign_key="user.id")
    household_id: int = Field(foreign_key="household.id", index=True)
    created_on: datetime = Field(sa_type=UTCDateTime)
    planned_for: datetime = Field(sa_type=UTCDateTime)

    created_by: "User" = Relationship()
    household: "Household" = Relationship()
    recipe: "Recipe" = Relationship(back_populates="planned")


class GroceryItemStatus(str, Enum):
    dismissed = "dismissed"
    deleted = "deleted"
    restored = "restored"  # keeps a past-due item active after auto-dismiss


class HouseholdRole(str, Enum):
    owner = "owner"
    member = "member"


class HouseholdInviteStatus(str, Enum):
    pending = "pending"
    accepted = "accepted"
    revoked = "revoked"
    expired = "expired"


class Household(BaseIndexedDbModel, table=True):
    name: str
    created_by_id: int = Field(foreign_key="user.id")
    created_on: datetime = Field(sa_type=UTCDateTime)

    created_by: "User" = Relationship()
    members: list["HouseholdMember"] = Relationship(
        back_populates="household",
        cascade_delete=True,
    )
    invites: list["HouseholdInvite"] = Relationship(
        back_populates="household",
        cascade_delete=True,
    )


class HouseholdMember(BaseIndexedDbModel, table=True):
    household_id: int = Field(foreign_key="household.id", index=True)
    user_id: int = Field(foreign_key="user.id", index=True, unique=True)
    role: str  # HouseholdRole value
    joined_on: datetime = Field(sa_type=UTCDateTime)

    household: Household = Relationship(back_populates="members")
    user: "User" = Relationship()


class HouseholdInvite(BaseIndexedDbModel, table=True):
    household_id: int = Field(foreign_key="household.id", index=True)
    # Null for shareable link/QR invites; set only for legacy email-bound invites.
    email: str | None = Field(default=None, index=True)
    invited_by_id: int = Field(foreign_key="user.id")
    token: str = Field(index=True, unique=True)
    status: str = HouseholdInviteStatus.pending.value
    created_on: datetime = Field(sa_type=UTCDateTime)
    expires_on: datetime = Field(sa_type=UTCDateTime)

    household: Household = Relationship(back_populates="invites")
    invited_by: "User" = Relationship()


class GroceryItemState(BaseIndexedDbModel, table=True):
    """Per-household grocery list state for a derived ingredient key."""

    created_by_id: int = Field(foreign_key="user.id", index=True)
    household_id: int = Field(foreign_key="household.id", index=True)
    item_key: str = Field(index=True)
    status: str  # GroceryItemStatus value
    updated_on: datetime = Field(sa_type=UTCDateTime)

    created_by: "User" = Relationship()
    household: Household = Relationship()


class GroceryManualItem(BaseIndexedDbModel, table=True):
    """Household-scoped ad-hoc grocery line not tied to a recipe."""

    created_by_id: int = Field(foreign_key="user.id", index=True)
    household_id: int = Field(foreign_key="household.id", index=True)
    name: str
    item_key: str = Field(index=True)
    amount: float | None = None
    units: str | None = None
    created_on: datetime = Field(sa_type=UTCDateTime)

    created_by: "User" = Relationship()
    household: Household = Relationship()
