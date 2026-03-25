from functools import lru_cache
from pathlib import Path

from pydantic import AliasChoices, Field
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
    openrouter_api_key: str = ""
    openrouter_model: str = "google/gemini-2.0-flash-001"

    cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000"

    cron_secret: str = ""


@lru_cache
def get_settings() -> Settings:
    return Settings()


def get_cors_list(settings: Settings) -> list[str]:
    return [o.strip() for o in settings.cors_origins.split(",") if o.strip()]
