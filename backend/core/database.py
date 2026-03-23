from functools import lru_cache

from supabase import Client, create_client

from core.config import Settings, get_settings


@lru_cache
def get_supabase() -> Client:
    s = get_settings()
    if not s.supabase_url or not s.supabase_service_role_key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set")
    return create_client(s.supabase_url, s.supabase_service_role_key)


def get_supabase_for_settings(settings: Settings) -> Client:
    return create_client(settings.supabase_url, settings.supabase_service_role_key)
