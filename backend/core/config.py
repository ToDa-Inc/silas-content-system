from functools import lru_cache

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", "../config/.env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    supabase_url: str = ""
    supabase_service_role_key: str = ""
    default_org_slug: str = "silas-agency"

    apify_api_token: str = Field(
        default="",
        validation_alias=AliasChoices("APIFY_API_TOKEN", "APIFY_API_KEY"),
    )
    openrouter_api_key: str = ""
    openrouter_model: str = "google/gemini-2.0-flash-001"

    cors_origins: str = "http://localhost:3000"


@lru_cache
def get_settings() -> Settings:
    return Settings()


def get_cors_list(settings: Settings) -> list[str]:
    return [o.strip() for o in settings.cors_origins.split(",") if o.strip()]
