from functools import lru_cache

import httpx
from supabase import Client, ClientOptions, create_client
from supabase_auth import SyncMemoryStorage

from core.config import Settings, get_settings


def _supabase_httpx_client() -> httpx.Client:
    """HTTP/1.1 only.

    Default httpx uses HTTP/2 to Supabase; under many parallel requests (e.g. Next.js
    fan-out) httpcore can raise ReadError [Errno 35] Resource temporarily unavailable on macOS.
    """
    return httpx.Client(
        http2=False,
        timeout=httpx.Timeout(120.0, connect=20.0),
        limits=httpx.Limits(max_keepalive_connections=20, max_connections=100),
    )


@lru_cache
def _cached_supabase(url: str, key: str) -> Client:
    if not url or not key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set")
    opts = ClientOptions(
        storage=SyncMemoryStorage(),
        httpx_client=_supabase_httpx_client(),
    )
    return create_client(url, key, options=opts)


def get_supabase() -> Client:
    s = get_settings()
    return _cached_supabase(
        (s.supabase_url or "").strip(),
        (s.supabase_service_role_key or "").strip(),
    )


def get_supabase_for_settings(settings: Settings) -> Client:
    return _cached_supabase(
        (settings.supabase_url or "").strip(),
        (settings.supabase_service_role_key or "").strip(),
    )
