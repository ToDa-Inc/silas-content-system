from typing import Annotated, Optional

from fastapi import Depends, Header, HTTPException, status
from supabase import Client

from core.config import Settings, get_settings
from core.database import get_supabase


def _parse_api_key(
    x_api_key: Optional[str],
    authorization: Optional[str],
) -> Optional[str]:
    if x_api_key and x_api_key.strip():
        return x_api_key.strip()
    if authorization and authorization.startswith("Bearer "):
        return authorization[7:].strip() or None
    return None


async def require_org_access(
    settings: Annotated[Settings, Depends(get_settings)],
    supabase: Annotated[Client, Depends(get_supabase)],
    x_org_slug: Annotated[Optional[str], Header(alias="X-Org-Slug")] = None,
    x_api_key: Annotated[Optional[str], Header(alias="X-Api-Key")] = None,
    authorization: Annotated[Optional[str], Header()] = None,
) -> str:
    """Resolve org_id after validating profiles.api_key + organization_members."""
    api_key = _parse_api_key(x_api_key, authorization)
    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing API key: send X-Api-Key or Authorization: Bearer <api_key>",
        )

    pres = supabase.table("profiles").select("id").eq("api_key", api_key).limit(1).execute()
    if not pres.data:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid API key")
    user_id = pres.data[0]["id"]

    slug = x_org_slug or settings.default_org_slug
    if not slug:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Missing X-Org-Slug header (send the signed-in user’s org slug from Supabase).",
        )
    org_res = supabase.table("organizations").select("id").eq("slug", slug).limit(1).execute()
    if not org_res.data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organization not found")
    org_id = org_res.data[0]["id"]

    mem = (
        supabase.table("organization_members")
        .select("id")
        .eq("user_id", user_id)
        .eq("org_id", org_id)
        .limit(1)
        .execute()
    )
    if not mem.data:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not a member of this organization (organization_members).",
        )
    return org_id


def resolve_client_id(
    slug: str,
    org_id: Annotated[str, Depends(require_org_access)],
    supabase: Annotated[Client, Depends(get_supabase)],
) -> str:
    res = (
        supabase.table("clients")
        .select("id")
        .eq("org_id", org_id)
        .eq("slug", slug)
        .limit(1)
        .execute()
    )
    if not res.data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Client not found")
    return res.data[0]["id"]
