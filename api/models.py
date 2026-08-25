from datetime import datetime, timezone
from enum import Enum
from typing import Optional

from sqlalchemy import MetaData
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
    created_by_id: int = Field(foreign_key="user.id")
    household_id: int = Field(foreign_key="household.id", index=True)
    created_on: datetime = Field(sa_type=UTCDateTime)
    name: str
    description: str
    instructions: str
    notes: str | None
    public: bool = False
    prep_time: float | None = None
    cover_image_id: int | None = Field(foreign_key="upload.id", default=None)
    # JSON float array + model id for hybrid semantic search (not exposed in API DTOs).
    embedding_json: str | None = None
    embedding_model: str | None = Field(default=None, max_length=120)

    created_by: "User" = Relationship()
    household: "Household" = Relationship()
    ingredients: list["Ingredient"] = Relationship(
        back_populates="recipe",
        cascade_delete=True,
    )
    planned: list["PlannedRecipe"] = Relationship(
        back_populates="recipe",
        cascade_delete=True,
    )
    cover_image: "Upload" = Relationship()


class Ingredient(BaseIndexedDbModel, table=True):
    created_by_id: int = Field(foreign_key="user.id")
    created_on: datetime = Field(sa_type=UTCDateTime)
    name: str
    amount: float | None = None
    units: str | None = None
    details: str | None = None
    recipe_id: int = Field(foreign_key="recipe.id")

    recipe: "Recipe" = Relationship(back_populates="ingredients")
    created_by: "User" = Relationship()


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
