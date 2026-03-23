from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from supabase import Client

from core.database import get_supabase
from core.deps import resolve_org_id
from models.client import ClientCreate, ClientOut, ClientUpdate

router = APIRouter(prefix="/api/v1/clients", tags=["clients"])


@router.get("", response_model=list[ClientOut])
def list_clients(
    org_id: Annotated[str, Depends(resolve_org_id)],
    supabase: Annotated[Client, Depends(get_supabase)],
) -> list[dict]:
    res = supabase.table("clients").select("*").eq("org_id", org_id).order("name").execute()
    return res.data or []


@router.post("", response_model=ClientOut, status_code=status.HTTP_201_CREATED)
def create_client(
    body: ClientCreate,
    org_id: Annotated[str, Depends(resolve_org_id)],
    supabase: Annotated[Client, Depends(get_supabase)],
) -> dict:
    row = {
        "org_id": org_id,
        "slug": body.slug,
        "name": body.name,
        "instagram_handle": body.instagram_handle,
        "language": body.language,
        "niche_config": body.niche_config,
        "icp": body.icp,
        "products": body.products,
        "is_active": True,
    }
    res = supabase.table("clients").insert(row).execute()
    if not res.data:
        raise HTTPException(status_code=400, detail="Insert failed")
    return res.data[0]


@router.get("/{slug}", response_model=ClientOut)
def get_client(
    slug: str,
    org_id: Annotated[str, Depends(resolve_org_id)],
    supabase: Annotated[Client, Depends(get_supabase)],
) -> dict:
    res = (
        supabase.table("clients")
        .select("*")
        .eq("org_id", org_id)
        .eq("slug", slug)
        .limit(1)
        .execute()
    )
    if not res.data:
        raise HTTPException(status_code=404, detail="Client not found")
    return res.data[0]


@router.put("/{slug}", response_model=ClientOut)
def update_client(
    slug: str,
    body: ClientUpdate,
    org_id: Annotated[str, Depends(resolve_org_id)],
    supabase: Annotated[Client, Depends(get_supabase)],
) -> dict:
    res = (
        supabase.table("clients")
        .select("id")
        .eq("org_id", org_id)
        .eq("slug", slug)
        .limit(1)
        .execute()
    )
    if not res.data:
        raise HTTPException(status_code=404, detail="Client not found")
    client_id = res.data[0]["id"]

    patch = {k: v for k, v in body.model_dump(exclude_unset=True).items()}
    if not patch:
        out = supabase.table("clients").select("*").eq("id", client_id).limit(1).execute()
        return out.data[0]

    supabase.table("clients").update(patch).eq("id", client_id).execute()
    out = supabase.table("clients").select("*").eq("id", client_id).limit(1).execute()
    return out.data[0]
