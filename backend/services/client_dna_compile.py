"""Compile client_dna briefs from niche_config + icp + client_context (one LLM call)."""

from __future__ import annotations

import hashlib
import json
import logging
import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

import httpx

from core.config import Settings

logger = logging.getLogger(__name__)

_COMPACTION_SYSTEM = """You are compressing client context into dense, task-optimized summaries called "briefs."
Each brief will be injected into a different AI prompt, so it must be self-contained and specific to its task.

Read ALL the context below. Source B (client's own words from onboarding) is the
authority — it reflects how the client actually thinks and talks. Source A (auto-generated
profile from Instagram scraping) fills structural gaps. Where they conflict, Source B wins.

Output MUST be a single JSON object with exactly 3 string keys (no markdown fences):
"analysis_brief", "generation_brief", "voice_brief".

"analysis_brief" — For reel analysis. The AI watching competitor reels needs to know
what "relatable" and "valuable" mean for THIS specific client and audience.
Include (roughly 800-1200 tokens of prose as one string, use \\n for paragraphs):
• IDENTITY: Who is this client? What do they do? Positioning.
• NICHE BOUNDARIES: What is IN scope vs OUT of scope (adjacent niches that are NOT theirs).
• TARGET AUDIENCE: Psychographics — situation, feelings when they find this content.
• PAIN POINTS & DESIRES: Use the client's own language from Source B where possible.
• CONTENT THAT RESONATES: Formats, angles, types of value.
• CONTENT THAT DOES NOT WORK: What should score low (generic fluff, wrong audience).
• VOICE & TONE: How the client communicates.

"generation_brief" — For content generation (hooks, captions, ideas). ~600-1000 tokens:
brand voice, angles, hook patterns, caption preferences, topics to avoid, unique perspective.

"voice_brief" — For script writing. ~400-700 tokens: how they talk, phrases, argument structure,
emotional register, language, what to never sound like.

If a section of the source is empty or says "Not covered," write honestly "Not enough data for X"
for that part. Do NOT invent facts."""


def _context_texts_only(client_context: Any) -> Dict[str, str]:
    out: Dict[str, str] = {}
    if not isinstance(client_context, dict):
        return out
    for key, val in client_context.items():
        if isinstance(val, dict):
            t = val.get("text")
            if isinstance(t, str) and t.strip():
                out[str(key)] = t.strip()
        elif isinstance(val, str) and val.strip():
            out[str(key)] = val.strip()
    return out


def compute_client_dna_source_hash(client_row: Dict[str, Any]) -> str:
    """Hash of niche_config + icp + client_context section texts only (no metadata)."""
    nc = client_row.get("niche_config")
    if nc is None:
        nc = []
    icp = client_row.get("icp")
    if not isinstance(icp, dict):
        icp = {}
    cc_texts = _context_texts_only(client_row.get("client_context"))
    blob = json.dumps(
        {"niche_config": nc, "icp": icp, "context_texts": cc_texts},
        sort_keys=True,
        default=str,
    )
    return hashlib.sha256(blob.encode()).hexdigest()[:16]


def _build_source_dumps(client_row: Dict[str, Any]) -> Tuple[str, str]:
    nc = client_row.get("niche_config") or []
    if not isinstance(nc, list):
        nc = []
    icp = client_row.get("icp") if isinstance(client_row.get("icp"), dict) else {}
    lines_a: List[str] = []
    lines_a.append(json.dumps(nc, indent=2, ensure_ascii=False)[:24_000])
    lines_a.append(json.dumps(icp, indent=2, ensure_ascii=False)[:24_000])
    source_a = "\n\n".join(lines_a)

    cc_texts = _context_texts_only(client_row.get("client_context"))
    if not cc_texts:
        source_b = "(empty)"
    else:
        parts = [f"## {k}\n{v[:50_000]}" for k, v in sorted(cc_texts.items())]
        source_b = "\n\n---\n\n".join(parts)
    return source_a, source_b


def _sources_meaningful(client_row: Dict[str, Any]) -> bool:
    nc = client_row.get("niche_config") or []
    if isinstance(nc, list) and len(nc) > 0:
        return True
    icp = client_row.get("icp") if isinstance(client_row.get("icp"), dict) else {}
    if icp and any(str(v).strip() for v in icp.values() if v is not None):
        return True
    return bool(_context_texts_only(client_row.get("client_context")))


def compile_client_dna(
    *,
    openrouter_key: str,
    model: str,
    client_row: Dict[str, Any],
    source_hash: str,
) -> Dict[str, Any]:
    """Run compaction LLM. Returns client_dna dict including metadata."""
    now = datetime.now(timezone.utc).isoformat()
    if not openrouter_key:
        raise RuntimeError("OPENROUTER_API_KEY not configured")

    if not _sources_meaningful(client_row):
        return {
            "analysis_brief": "",
            "generation_brief": "",
            "voice_brief": "",
            "source_hash": source_hash,
            "compiled_at": now,
            "compiled_by": "",
        }

    source_a, source_b = _build_source_dumps(client_row)
    user_msg = (
        "=== SOURCE A: Structured Profile (auto-generated) ===\n"
        f"{source_a}\n\n"
        "=== SOURCE B: Client Brain (from onboarding/uploads) ===\n"
        f"{source_b}"
    )

    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": _COMPACTION_SYSTEM},
            {"role": "user", "content": user_msg[:200_000]},
        ],
        "max_tokens": 12_288,
        "temperature": 0.2,
    }
    with httpx.Client(timeout=300.0) as client:
        r = client.post(
            "https://openrouter.ai/api/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {openrouter_key}",
                "Content-Type": "application/json",
                "HTTP-Referer": "https://silas-content-system.local",
                "X-Title": "Content Machine",
            },
            json=payload,
        )
        r.raise_for_status()
        data = r.json()
    if data.get("error"):
        raise RuntimeError(data["error"].get("message", str(data["error"])))
    content = data["choices"][0]["message"]["content"]
    cleaned = re.sub(r"^```json\s*", "", content.strip())
    cleaned = re.sub(r"^```\s*", "", cleaned).strip()
    cleaned = re.sub(r"```\s*$", "", cleaned).strip()
    try:
        parsed: Any = json.loads(cleaned)
    except json.JSONDecodeError as e:
        raise RuntimeError(f"DNA compile returned invalid JSON: {e}") from e
    if not isinstance(parsed, dict):
        raise RuntimeError("DNA compile returned non-object JSON")

    def _s(key: str) -> str:
        v = parsed.get(key)
        return str(v).strip() if v is not None else ""

    return {
        "analysis_brief": _s("analysis_brief"),
        "generation_brief": _s("generation_brief"),
        "voice_brief": _s("voice_brief"),
        "source_hash": source_hash,
        "compiled_at": now,
        "compiled_by": model,
    }


def maybe_recompile_client_dna(
    settings: Settings,
    supabase,
    client_id: str,
    *,
    force: bool = False,
) -> None:
    """Recompile client_dna if source hash changed, or always if force=True."""
    res = (
        supabase.table("clients")
        .select(
            "id, niche_config, icp, client_context, client_dna, name, instagram_handle, language"
        )
        .eq("id", client_id)
        .limit(1)
        .execute()
    )
    if not res.data:
        logger.warning("client_dna: client %s not found", client_id)
        return
    row = dict(res.data[0])
    new_hash = compute_client_dna_source_hash(row)
    existing = row.get("client_dna") if isinstance(row.get("client_dna"), dict) else {}
    old_hash = (existing or {}).get("source_hash") if isinstance(existing, dict) else None

    if not force and old_hash == new_hash:
        return

    if not settings.openrouter_api_key:
        logger.warning("client_dna: skip compile — OPENROUTER_API_KEY missing")
        return

    try:
        dna = compile_client_dna(
            openrouter_key=settings.openrouter_api_key,
            model=settings.openrouter_model,
            client_row=row,
            source_hash=new_hash,
        )
    except Exception:
        logger.exception("client_dna compile failed for client %s", client_id)
        return

    supabase.table("clients").update({"client_dna": dna}).eq("id", client_id).execute()


def force_recompile_client_dna_sync(
    settings: Settings,
    supabase,
    client_id: str,
) -> Dict[str, Any]:
    """Synchronous force recompile; returns the new client_dna or raises."""
    res = (
        supabase.table("clients")
        .select(
            "id, niche_config, icp, client_context, client_dna, name, instagram_handle, language"
        )
        .eq("id", client_id)
        .limit(1)
        .execute()
    )
    if not res.data:
        raise ValueError("Client not found")
    row = dict(res.data[0])
    new_hash = compute_client_dna_source_hash(row)
    if not settings.openrouter_api_key:
        raise RuntimeError("OPENROUTER_API_KEY not configured")
    dna = compile_client_dna(
        openrouter_key=settings.openrouter_api_key,
        model=settings.openrouter_model,
        client_row=row,
        source_hash=new_hash,
    )
    supabase.table("clients").update({"client_dna": dna}).eq("id", client_id).execute()
    return dna
