from functools import lru_cache
from pathlib import Path

from pydantic import AliasChoices, Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_BACKEND_DIR = Path(__file__).resolve().parent.parent
_REPO_ROOT = _BACKEND_DIR.parent


class Settings(BaseSettings):
    # Later files override earlier. Repo-root `.env` is last so local secrets win over
    # `config/.env` placeholders (e.g. empty `APIFY_API_TOKEN=` must not wipe a token set
    # in the root file or in `APIFY_API_KEY`).
    model_config = SettingsConfigDict(
        env_file=(
            str(_BACKEND_DIR / ".env"),
            str(_REPO_ROOT / "config" / ".env"),
            str(_REPO_ROOT / ".env"),
        ),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    supabase_url: str = ""
    supabase_service_role_key: str = ""
    default_org_slug: str = ""

    apify_api_token: str = Field(
        default="",
        validation_alias=AliasChoices("APIFY_API_TOKEN", "APIFY_API_KEY"),
    )

    apify_reel_actor: str = Field(
        default="apify~instagram-reel-scraper",
        validation_alias=AliasChoices("APIFY_REEL_ACTOR"),
        description="Apify actor id or username~name for Instagram reel profile scrapes.",
    )

    apify_include_shares_count: bool = Field(
        default=True,
        validation_alias=AliasChoices("APIFY_INCLUDE_SHARES_COUNT"),
        description="Sets includeSharesCount on Instagram Reel Scraper (requires paid Apify plan for real values).",
    )

    @field_validator("apify_api_token", mode="before")
    @classmethod
    def strip_apify_token(cls, v: object) -> object:
        if isinstance(v, str):
            return v.strip()
        return v

    @field_validator("apify_reel_actor", mode="before")
    @classmethod
    def strip_reel_actor(cls, v: object) -> object:
        if isinstance(v, str):
            s = v.strip()
            return s if s else "apify~instagram-reel-scraper"
        return v
    openrouter_api_key: str = ""
    freepik_api_key: str = ""
    openai_api_key: str = Field(
        default="",
        validation_alias=AliasChoices("OPENAI_API_KEY"),
    )

    @field_validator("openai_api_key", mode="before")
    @classmethod
    def strip_openai_key(cls, v: object) -> object:
        if isinstance(v, str):
            return v.strip()
        return v
    openrouter_model: str = "google/gemini-2.0-flash-001"
    openrouter_model_fallback: str = Field(
        default="",
        validation_alias=AliasChoices("OPENROUTER_MODEL_FALLBACK"),
        description="Optional OpenRouter model id; on 429 from primary, retry once with this model (text/chat paths; skipped for video multimodal).",
    )

    @field_validator("openrouter_model_fallback", mode="before")
    @classmethod
    def strip_openrouter_model_fallback(cls, v: object) -> object:
        if isinstance(v, str):
            return v.strip()
        return v

    openrouter_reel_analyze_model: str = Field(
        default="google/gemini-3-flash-preview",
        description="OpenRouter model id for single-reel MP4 analysis.",
    )

    cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000"

    cron_secret: str = ""


@lru_cache
def get_settings() -> Settings:
    return Settings()


def get_cors_list(settings: Settings) -> list[str]:
    return [o.strip() for o in settings.cors_origins.split(",") if o.strip()]
