from typing import Annotated, Optional

from fastapi import Depends, Header, HTTPException, status
from supabase import Client

from core.config import Settings, get_settings
from core.database import get_supabase


async def resolve_org_id(
    settings: Annotated[Settings, Depends(get_settings)],
    supabase: Annotated[Client, Depends(get_supabase)],
    x_org_slug: Annotated[Optional[str], Header(alias="X-Org-Slug")] = None,
) -> str:
    slug = x_org_slug or settings.default_org_slug
    if not slug:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Set X-Org-Slug header or DEFAULT_ORG_SLUG in environment",
        )
    res = supabase.table("organizations").select("id").eq("slug", slug).limit(1).execute()
    if not res.data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organization not found")
    return res.data[0]["id"]
