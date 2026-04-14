import logging
from datetime import datetime, timezone
from typing import Annotated, Any, Dict, List

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from supabase import Client

from core.config import Settings, get_settings
from core.database import get_supabase, get_supabase_for_settings
from core.deps import require_org_access, resolve_client_id
from core.id_generator import generate_client_id
from models.client import (
    ClientCreate,
    ClientOut,
    ClientUpdate,
    DnaChatApplyBody,
    DnaChatUpdateBody,
)
from services.client_dna_compile import force_recompile_client_dna_sync, maybe_recompile_client_dna
from services.dna_chat_update import (
    coerce_analysis_brief_patch,
    merge_analysis_brief_into_client_dna,
    run_dna_profile_chat_update,
)

router = APIRouter(prefix="/api/v1/clients", tags=["clients"])
logger = logging.getLogger(__name__)

_DNA_TRIGGER_FIELDS = frozenset({"niche_config", "icp", "client_context"})


def _background_recompile_client_dna(client_id: str) -> None:
    try:
        settings = get_settings()
        supabase = get_supabase_for_settings(settings)
        maybe_recompile_client_dna(settings, supabase, client_id, force=False)
    except Exception:
        logger.exception("client_dna background recompile failed for %s", client_id)


@router.get("", response_model=list[ClientOut])
def list_clients(
    org_id: Annotated[str, Depends(require_org_access)],
    supabase: Annotated[Client, Depends(get_supabase)],
) -> list[dict]:
    res = supabase.table("clients").select("*").eq("org_id", org_id).order("name").execute()
    return res.data or []


@router.post("", response_model=ClientOut, status_code=status.HTTP_201_CREATED)
def create_client(
    body: ClientCreate,
    org_id: Annotated[str, Depends(require_org_access)],
    supabase: Annotated[Client, Depends(get_supabase)],
) -> dict:
    row = {
        "id": generate_client_id(),
        "org_id": org_id,
        "slug": body.slug,
        "name": body.name,
        "instagram_handle": body.instagram_handle,
        "language": body.language,
        "niche_config": body.niche_config,
        "icp": body.icp,
        "products": body.products,
        "client_context": body.client_context or {},
        "is_active": True,
        "outlier_ratio_threshold": 5.0,
    }
    res = supabase.table("clients").insert(row).execute()
    if not res.data:
        raise HTTPException(status_code=400, detail="Insert failed")
    return res.data[0]


@router.post("/{slug}/dna/regenerate", response_model=ClientOut)
def regenerate_client_dna(
    slug: str,
    org_id: Annotated[str, Depends(require_org_access)],
    client_id: Annotated[str, Depends(resolve_client_id)],
    supabase: Annotated[Client, Depends(get_supabase)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> dict:
    """Force recompile client_dna briefs (OpenRouter)."""
    _ = org_id
    _ = slug
    try:
        force_recompile_client_dna_sync(settings, supabase, client_id)
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    out = supabase.table("clients").select("*").eq("id", client_id).limit(1).execute()
    if not out.data:
        raise HTTPException(status_code=404, detail="Client not found")
    return out.data[0]


@router.post("/{slug}/dna/chat-preview")
def dna_chat_preview(
    slug: str,
    body: DnaChatUpdateBody,
    org_id: Annotated[str, Depends(require_org_access)],
    client_id: Annotated[str, Depends(resolve_client_id)],
    supabase: Annotated[Client, Depends(get_supabase)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> Dict[str, Any]:
    """LLM proposes edits to client_dna.analysis_brief only; nothing persisted."""
    _ = org_id
    _ = slug
    if not settings.openrouter_api_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="OPENROUTER_API_KEY not configured",
        )

    res = supabase.table("clients").select("*").eq("id", client_id).limit(1).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Client not found")
    row = dict(res.data[0])
    existing_dna = row.get("client_dna") if isinstance(row.get("client_dna"), dict) else {}
    current_brief = str(existing_dna.get("analysis_brief") or "")
    try:
        changed, summary = run_dna_profile_chat_update(
            openrouter_key=settings.openrouter_api_key,
            model=settings.openrouter_model,
            current_brief=current_brief,
            instruction=body.message,
            client_language=str(row.get("language") or "de"),
        )
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e)) from e

    before = {"analysis_brief": current_brief} if changed else {}
    return {
        "summary": summary,
        "changed_sections": changed,
        "before": before,
        "updated_sections": list(changed.keys()),
    }


@router.post("/{slug}/dna/chat-apply")
def dna_chat_apply(
    slug: str,
    body: DnaChatApplyBody,
    org_id: Annotated[str, Depends(require_org_access)],
    client_id: Annotated[str, Depends(resolve_client_id)],
    supabase: Annotated[Client, Depends(get_supabase)],
    _settings: Annotated[Settings, Depends(get_settings)],
) -> Dict[str, Any]:
    """Persist previewed analysis_brief into client_dna only (client_context unchanged, no auto-recompile)."""
    _ = org_id
    _ = slug
    new_brief = coerce_analysis_brief_patch(body.changed_sections)
    if not new_brief:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No valid analysis brief to apply.",
        )

    res = supabase.table("clients").select("*").eq("id", client_id).limit(1).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Client not found")
    row = dict(res.data[0])
    existing_dna = row.get("client_dna") if isinstance(row.get("client_dna"), dict) else {}

    now = datetime.now(timezone.utc).isoformat()
    new_dna = merge_analysis_brief_into_client_dna(existing_dna, new_brief, now_iso=now)
    supabase.table("clients").update({"client_dna": new_dna}).eq("id", client_id).execute()

    out = supabase.table("clients").select("*").eq("id", client_id).limit(1).execute()
    final = dict(out.data[0]) if out.data else row
    summary_out = (body.summary or "").strip() or "Analysis brief saved."
    return {
        "summary": summary_out,
        "updated_sections": ["analysis_brief"],
        "client": final,
    }


@router.get("/{slug}", response_model=ClientOut)
def get_client(
    slug: str,
    org_id: Annotated[str, Depends(require_org_access)],
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
    background_tasks: BackgroundTasks,
    org_id: Annotated[str, Depends(require_org_access)],
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

    if _DNA_TRIGGER_FIELDS & set(patch.keys()):
        background_tasks.add_task(_background_recompile_client_dna, client_id)

    return out.data[0]
