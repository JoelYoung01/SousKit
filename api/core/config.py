import secrets
import warnings
from typing import Annotated, Any, Literal

from pydantic import AnyUrl, BeforeValidator, computed_field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from typing_extensions import Self


def parse_cors(v: Any) -> list[str] | str:
    if isinstance(v, str) and not v.startswith("["):
        return [i.strip() for i in v.split(",")]
    elif isinstance(v, list | str):
        return v
    raise ValueError(v)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        # Use top level .env file (one level above ./backend/)
        env_file="../.env",
        env_ignore_empty=True,
        extra="ignore",
    )
    API_V1_STR: str = "/api"
    PROJECT_NAME: str = "Sous Kit"
    # Deployed git SHA (or "dev" locally). Used by /api/health/ for release checks.
    APP_VERSION: str = "dev"
    SECRET_KEY: str = secrets.token_urlsafe(32)
    # 60 minutes * 24 hours * 8 days = 8 days
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 8
    HASH_ALGORITHM: str = "HS256"
    FRONTEND_HOST: str = "http://localhost:5173"
    ENVIRONMENT: Literal["development", "staging", "production"] = "development"
    VITE_GOOGLE_CLIENT_ID: str
    # Extra Google OAuth audience for the iOS app (optional). Native sign-in
    # produces id_tokens whose `aud` is the iOS client, not the web client.
    GOOGLE_IOS_CLIENT_ID: str | None = None
    # Sign in with Apple: identity tokens minted by the iOS app carry its
    # bundle identifier as `aud`. Must match `ios.bundleIdentifier` in
    # mobile/app.config.ts (SOUSKIT_IOS_BUNDLE_ID override).
    APPLE_APP_BUNDLE_ID: str = "com.joelyoung.souskit"
    # Apple Developer Team ID (10 chars). When set, the API serves
    # `/.well-known/apple-app-site-association` so Universal Links can open
    # household join URLs in the iOS app (fallback: web).
    APPLE_TEAM_ID: str | None = None
    # Path segment for household join links (paired with FRONTEND_HOST).
    HOUSEHOLD_JOIN_PATH: str = "/join"
    VUE_STATIC_DIR: str = "dist"
    UPLOAD_DIR: str = "data/uploads"
    LOGS_DIR: str = "data/logs"

    # Password / email verification
    PASSWORD_MIN_LENGTH: int = 8
    EMAIL_OTP_EXPIRE_MINUTES: int = 15
    EMAIL_OTP_MAX_ATTEMPTS: int = 5
    EMAIL_OTP_RESEND_COOLDOWN_SECONDS: int = 60
    VERIFY_EMAIL_PATH: str = "/verify-email"

    BACKEND_CORS_ORIGINS: Annotated[list[AnyUrl] | str, BeforeValidator(parse_cors)] = (
        []
    )

    @computed_field  # type: ignore[prop-decorator]
    @property
    def all_cors_origins(self) -> list[str]:
        return [str(origin).rstrip("/") for origin in self.BACKEND_CORS_ORIGINS] + [
            self.FRONTEND_HOST
        ]

    # PROJECT_NAME: str
    # SENTRY_DSN: HttpUrl | None = None
    # POSTGRES_SERVER: str
    # POSTGRES_PORT: int = 5432
    # POSTGRES_USER: str
    # POSTGRES_PASSWORD: str = ""
    # POSTGRES_DB: str = ""
    SQLITE_FILE_NAME: str = "data/database.db"

    @computed_field  # type: ignore[prop-decorator]
    @property
    def SQLITE_DATABASE_URL(self) -> str:
        return f"sqlite:///{self.SQLITE_FILE_NAME}"

    # @computed_field  # type: ignore[prop-decorator]
    # @property
    # def SQLALCHEMY_DATABASE_URI(self) -> PostgresDsn:
    #     return MultiHostUrl.build(
    #         scheme="postgresql+psycopg",
    #         username=self.POSTGRES_USER,
    #         password=self.POSTGRES_PASSWORD,
    #         host=self.POSTGRES_SERVER,
    #         port=self.POSTGRES_PORT,
    #         path=self.POSTGRES_DB,
    #     )

    SMTP_TLS: bool = True
    SMTP_SSL: bool = False
    SMTP_PORT: int = 587
    SMTP_HOST: str | None = None
    SMTP_USER: str | None = None
    SMTP_PASSWORD: str | None = None
    EMAILS_FROM_EMAIL: str | None = None
    EMAILS_FROM_NAME: str | None = None

    @model_validator(mode="after")
    def _set_default_emails_from(self) -> Self:
        if self.EMAILS_FROM_NAME is None:
            self.EMAILS_FROM_NAME = self.PROJECT_NAME
        return self

    SUPERUSER_GID: str

    # Optional OpenRouter credentials for meal-plan wizard LLM and embeddings.
    # When unset, the wizard uses a deterministic stub client and recipe search
    # falls back to a local hashing embedder (hybrid lexical + stub vectors).
    OPENROUTER_API_KEY: str | None = None
    OPENROUTER_MODEL: str = "inception/mercury-2"
    OPENROUTER_EMBEDDING_MODEL: str = "openai/text-embedding-3-small"
    OPENROUTER_EMBEDDING_DIMENSIONS: int = 384
    # OpenRouter Image API (when IMAGE_GEN_PROVIDER=openrouter).
    # Seedream 4.5 balances photoreal food quality with multi-image support;
    # requires 2K+ output (1K is rejected). ~$0.04–0.05/image at 2K.
    OPENROUTER_IMAGE_MODEL: str = "bytedance-seed/seedream-4.5"
    OPENROUTER_IMAGE_RESOLUTION: str = "2K"
    OPENROUTER_IMAGE_ASPECT_RATIO: str = "1:1"
    OPENROUTER_IMAGE_BASE_URL: str = "https://openrouter.ai/api/v1/images"

    # Cover-image provider for newly generated recipes.
    #   stub       — no network; leave cover unset
    #   broke      — free CC0/public-domain search via Openverse (default)
    #   openrouter — AI generation via OpenRouter (OPENROUTER_API_KEY)
    #   qwen       — DashScope Qwen-Image (requires DASHSCOPE_API_KEY; not wired yet)
    IMAGE_GEN_PROVIDER: str = "broke"
    OPENVERSE_BASE_URL: str = "https://api.openverse.org/v1"
    OPENVERSE_LICENSES: str = "cc0,pdm"
    DASHSCOPE_API_KEY: str | None = None
    QWEN_IMAGE_MODEL: str = "qwen-image-3.0-pro"
    DASHSCOPE_IMAGE_BASE_URL: str = (
        "https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/"
        "multimodal-generation/generation"
    )

    # Local seed password users (development / first load_data)
    SEED_ADMIN_EMAIL: str = "admin@example.com"
    SEED_ADMIN_PASSWORD: str = "adminpass123"
    SEED_TEST_EMAIL: str = "test@example.com"
    SEED_TEST_PASSWORD: str = "testpass123"

    def _check_default_secret(self, var_name: str, value: str | None) -> None:
        if value == "changethis":
            message = (
                f'The value of {var_name} is "changethis", '
                "for security, please change it, at least for deployments."
            )
            if self.ENVIRONMENT == "development":
                warnings.warn(message, stacklevel=1)
            else:
                raise ValueError(message)

    @model_validator(mode="after")
    def _enforce_non_default_secrets(self) -> Self:
        self._check_default_secret("SECRET_KEY", self.SECRET_KEY)
        self._check_default_secret("VITE_GOOGLE_CLIENT_ID", self.VITE_GOOGLE_CLIENT_ID)
        # self._check_default_secret("POSTGRES_PASSWORD", self.POSTGRES_PASSWORD)
        # self._check_default_secret(
        #     "FIRST_SUPERUSER_PASSWORD", self.FIRST_SUPERUSER_PASSWORD
        # )

        return self


settings = Settings()  # type: ignore
