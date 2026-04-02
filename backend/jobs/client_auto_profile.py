"""Auto-profile client from Instagram captions + bio → niche_config, icp, competitor_seeds (products JSON)."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List

logger = logging.getLogger(__name__)

from core.config import Settings
from core.database import get_supabase_for_settings
from services.apify import instagram_reel_scraper_input, run_actor
from services.instagram_account_lookup import fetch_instagram_user_by_username
from services.openrouter import analyze_creator_profile


def _caption_lines_from_reels(supabase, client_id: str, limit: int = 30) -> List[str]:
    res = (
        supabase.table("scraped_reels")
        .select("caption, posted_at")
        .eq("client_id", client_id)
        .is_("competitor_id", "null")
        .order("posted_at", desc=True)
        .limit(limit)
        .execute()
    )
    lines: List[str] = []
    for row in res.data or []:
        c = (row.get("caption") or "").strip()
        if c:
            lines.append(c[:500])
    return lines


def _captions_from_apify_items(items: List[dict], cap: int = 30) -> List[str]:
    out: List[str] = []
    for item in items:
        if item.get("type") not in ("Video", "GraphVideo"):
            continue
        c = item.get("caption")
        if isinstance(c, dict):
            t = str(c.get("text") or "").strip()
        elif isinstance(c, str):
            t = c.strip()
        else:
            t = ""
        if t:
            out.append(t[:500])
        if len(out) >= cap:
            break
    return out


def _build_profile_prompt(
    *,
    name: str,
    ig: str,
    language: str,
    bio: str,
    niche_hint: str,
    captions: List[str],
) -> str:
    cap_block = "\n".join(f'{i + 1}. "{c}"' for i, c in enumerate(captions))
    hint = f'\nUser-provided niche hint: "{niche_hint}"\n' if niche_hint else ""
    return f"""You are analyzing an Instagram creator to build their niche profile. This profile is used with Instagram USER SEARCH, which matches BIOS and DISPLAY NAMES — not post captions.

CREATOR:
Name: {name}
Instagram: @{ig}
Language setting: {language}
Bio: "{bio}"
{hint}
RECENT CAPTIONS ({len(captions)} reels):
{cap_block}

---

1. Identify 1-3 niches. Each: id (kebab-case), name, description, content_angles (5 strings from captions).

2. **IDENTITY keywords** — phrases similar creators put IN THEIR BIO (job titles, roles). NOT topic phrases from posts.
   ✅ leadership coach, executive coach, workplace communication trainer, Führungskräfte Coach
   ❌ toxic workplace, boundaries at work, difficult boss, Kommunikation Arbeitsplatz
   Per niche: keywords (4-6 EN), keywords_de (3-5 DE if relevant).

3. icp: target, age_range, pain_points (array), desires (array).

4. competitor_seeds: 5-10 Instagram usernames (no @) of likely similar creators (same as manually adding competitors you already know).

5. Per niche, **topic hashtags** for Instagram discovery (no # symbol): hashtags (4-8 EN), hashtags_de (3-6 DE if relevant). These are TOPIC tags used in posts, not bio identity phrases.

6. content_style: educator | storyteller | motivational | mixed | entertainer
7. primary_language: short label e.g. German / English

RESPOND IN THIS EXACT JSON FORMAT (no markdown):
{{
  "niches": [{{"id": "...", "name": "...", "description": "...", "keywords": [], "keywords_de": [], "content_angles": [], "hashtags": [], "hashtags_de": []}}],
  "icp": {{"target": "...", "age_range": "...", "pain_points": [], "desires": []}},
  "competitor_seeds": ["username1"],
  "content_style": "educator",
  "primary_language": "German",
  "confidence": "high"
}}
"""


def _map_language(label: str, fallback: str) -> str:
    s = (label or "").lower()
    if "german" in s or s in ("de", "deutsch"):
        return "de"
    if "english" in s or s in ("en", "eng"):
        return "en"
    return fallback if fallback in ("de", "en") else "de"


def run_client_auto_profile(settings: Settings, job: Dict[str, Any]) -> None:
    if not settings.apify_api_token or not settings.openrouter_api_key:
        raise RuntimeError("APIFY_API_TOKEN and OPENROUTER_API_KEY required")

    supabase = get_supabase_for_settings(settings)
    job_id = job["id"]
    client_id = job.get("client_id")
    if not client_id:
        raise RuntimeError("client_auto_profile job missing client_id")

    crow = supabase.table("clients").select("*").eq("id", client_id).limit(1).execute()
    if not crow.data:
        raise RuntimeError("Client not found")
    client = crow.data[0]

    ig = (client.get("instagram_handle") or "").replace("@", "").strip()
    if not ig:
        raise RuntimeError("Client has no instagram_handle")

    captions = _caption_lines_from_reels(supabase, client_id, limit=30)
    if len(captions) < 5:
        items = run_actor(
            settings.apify_api_token,
            settings.apify_reel_actor,
            instagram_reel_scraper_input(
                [ig],
                30,
                include_shares_count=settings.apify_include_shares_count,
            ),
        )
        captions = _captions_from_apify_items(items or [], 30)
    if len(captions) < 3:
        raise RuntimeError("Not enough captions to profile — run baseline refresh first or check the Instagram handle")

    snap = fetch_instagram_user_by_username(
        settings.apify_api_token,
        ig,
        exclude_username="",
        reel_actor=settings.apify_reel_actor,
        include_shares_count=settings.apify_include_shares_count,
    )
    bio = (snap.get("bio") if snap else "") or ""

    icp = client.get("icp") or {}
    niche_hint = ""
    if isinstance(icp, dict):
        niche_hint = str(icp.get("summary") or "").strip()

    prompt = _build_profile_prompt(
        name=str(client.get("name") or ""),
        ig=ig,
        language=str(client.get("language") or "de"),
        bio=bio,
        niche_hint=niche_hint,
        captions=captions,
    )
    ai = analyze_creator_profile(settings.openrouter_api_key, prompt, settings.openrouter_model)
    niches = ai.get("niches")
    if not isinstance(niches, list) or len(niches) < 1:
        raise RuntimeError("Auto-profile returned no niches")

    new_icp = ai.get("icp") if isinstance(ai.get("icp"), dict) else {}
    seeds = ai.get("competitor_seeds")
    if not isinstance(seeds, list):
        seeds = []
    seeds = [str(s).strip().lstrip("@") for s in seeds if str(s).strip()][:15]

    products = dict(client.get("products") or {})
    products["competitor_seeds"] = seeds
    products["auto_profile"] = {
        "content_style": ai.get("content_style"),
        "confidence": ai.get("confidence"),
        "job_id": job_id,
        "at": datetime.now(timezone.utc).isoformat(),
    }

    lang = _map_language(str(ai.get("primary_language") or ""), str(client.get("language") or "de"))

    supabase.table("clients").update(
        {
            "niche_config": niches,
            "icp": new_icp,
            "products": products,
            "language": lang,
        }
    ).eq("id", client_id).execute()

    try:
        from services.client_dna_compile import maybe_recompile_client_dna

        maybe_recompile_client_dna(settings, supabase, client_id, force=False)
    except Exception:
        logger.exception("client_dna recompile after auto_profile failed for %s", client_id)

    supabase.table("background_jobs").update(
        {
            "status": "completed",
            "completed_at": datetime.now(timezone.utc).isoformat(),
            "result": {
                "pipeline": "client_auto_profile",
                "niches_count": len(niches),
                "seeds_count": len(seeds),
                "captions_used": len(captions),
                "openrouter_model": settings.openrouter_model,
            },
        }
    ).eq("id", job_id).execute()
