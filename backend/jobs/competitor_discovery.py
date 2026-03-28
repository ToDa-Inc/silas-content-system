"""competitor_discovery job — ports scripts/competitor-discovery.js pipeline."""

from __future__ import annotations

import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from core.config import Settings
from core.database import get_supabase_for_settings
from core.id_generator import generate_competitor_id
from services.apify import REEL_ACTOR, SEARCH_ACTOR, run_actor, run_keyword_reel_search
from services.instagram_account_lookup import fetch_instagram_user_by_username
from services.competitor_scoring import evaluate_competitor
from services.openrouter import analyze_relevance


def _build_niche_profile(cfg: Dict[str, Any]) -> str:
    niches = cfg.get("niches") or []
    lines = []
    for n in niches:
        name = n.get("name", "")
        desc = n.get("description", "")
        angles = n.get("content_angles") or []
        lines.append(f"- {name}: {desc}\n  Key topics: {', '.join(angles)}")
    niches_block = "\n".join(lines)
    icp = cfg.get("icp") or {}
    lang = cfg.get("language") or "de"
    lang_label = "German" if str(lang).lower() in ("de", "german") else str(lang)

    return f"""CLIENT NICHE PROFILE:
Name: {cfg.get('name', '')}
Instagram: @{cfg.get('instagram', '')}
Language: {lang_label}

NICHES:
{niches_block}

TARGET AUDIENCE:
{icp.get('target', '')}
Age: {icp.get('age_range', '')}
Pain points: {'; '.join(icp.get('pain_points') or [])}
Desires: {'; '.join(icp.get('desires') or [])}"""


def _build_relevance_prompt(niche_profile: str, account_data: dict, captions: List[dict]) -> str:
    caption_block = "\n".join(
        f'POST {i + 1}: "{(c.get("caption") or "")[:300]}"' for i, c in enumerate(captions)
    )
    lang = account_data.get("_client_lang") or "de"
    lang_note = "German" if str(lang).lower() in ("de", "german") else str(lang)

    return f"""You are an Instagram content analyst. Your job is to determine if a discovered account is a GENUINE COMPETITOR — meaning they create similar content for a similar audience.

{niche_profile}

---

DISCOVERED ACCOUNT:
Username: @{account_data.get('username', '')}
{f'Bio: "{account_data.get("bio")}"' if account_data.get('bio') else ''}
{f"Followers: {account_data.get('followers', 0):,}" if account_data.get('followers') else ''}

RECENT POST CAPTIONS:
{caption_block}

---

ANALYSIS INSTRUCTIONS:
1. Read the captions carefully. Do they consistently cover the same topics as the client's niches?
2. Watch for FALSE POSITIVES:
   - Motivational quote accounts that occasionally mention "workplace" but aren't focused on it
   - Corporate brand accounts (not individual creators/educators)
   - Fitness/wellness coaches who sometimes mention "boundaries" but in a personal, not workplace context
   - Generic life coaches with broad advice that only tangentially overlaps
   - Accounts in the same language but different niche entirely
3. A real competitor should be an EDUCATOR or CONTENT CREATOR who regularly produces content about SIMILAR TOPICS for a SIMILAR AUDIENCE.
4. Language match matters: if the client creates content in {lang_note}, accounts in the same language are more relevant (but English-language accounts in the same niche are still valuable competitors to track).

RESPOND IN THIS EXACT JSON FORMAT (no markdown, no backticks):
{{
  "relevance_score": <0-100>,
  "is_competitor": <true/false>,
  "confidence": "<high/medium/low>",
  "primary_topics": ["topic1", "topic2", "topic3"],
  "content_style": "<educator/motivational/brand/mixed/other>",
  "overlap_niches": ["niche_id_1"],
  "language": "<detected language>",
  "reasoning": "<2-3 sentences explaining why this is or isn't a competitor>"
}}"""


def _discover_by_keyword(
    token: str, search_term: str, max_results: int, exclude_username: str
) -> List[dict]:
    results = run_actor(
        token,
        SEARCH_ACTOR,
        {"search": search_term, "searchType": "user", "resultsLimit": max_results * 2},
    )
    exclude = (exclude_username or "").lower().strip("@")
    accounts: List[dict] = []
    for r in results:
        username = r.get("username")
        if not username or username.lower() == exclude:
            continue
        priv = r.get("private")
        if priv:
            continue
        followers = int(r.get("followersCount") or 0)
        if followers < 500 or followers > 5_000_000:
            continue
        accounts.append(
            {
                "username": username,
                "fullName": r.get("fullName") or "",
                "bio": r.get("biography") or "",
                "followers": followers,
                "isVerified": r.get("verified") or False,
                "isPrivate": priv or False,
                "profileUrl": f"https://www.instagram.com/{username}/",
                "_latestPosts": r.get("latestPosts") or [],
            }
        )
        if len(accounts) >= max_results:
            break
    return accounts


def _scrape_account_posts(
    token: str, user: str, count: int, cached_posts: Optional[List] = None
) -> List[dict]:
    cached_posts = cached_posts or []
    if len(cached_posts) >= 3:
        out = []
        for r in cached_posts[:count]:
            cap = r.get("caption")
            if isinstance(cap, dict):
                cap = cap.get("text") or ""
            out.append(
                {
                    "caption": cap or "",
                    "views": int(r.get("videoViewCount") or r.get("videoPlayCount") or 0),
                    "likes": int(r.get("likesCount") or 0),
                    "comments": int(r.get("commentsCount") or 0),
                    "duration": int(r.get("videoDuration") or 0),
                    "url": r.get("url")
                    or (
                        f"https://www.instagram.com/p/{r.get('shortCode')}/"
                        if r.get("shortCode")
                        else ""
                    ),
                    "timestamp": r.get("timestamp") or "",
                }
            )
        return out

    results = run_actor(token, REEL_ACTOR, {"username": [user], "resultsLimit": count})
    posts: List[dict] = []
    for r in results:
        if r.get("type") not in ("Video", "GraphVideo") and not r.get("caption"):
            continue
        cap = r.get("caption")
        if isinstance(cap, dict):
            cap = cap.get("text") or ""
        elif cap is None:
            cap = ""
        posts.append(
            {
                "caption": cap,
                "views": int(r.get("videoViewCount") or r.get("playsCount") or 0),
                "likes": int(r.get("likesCount") or 0),
                "comments": int(r.get("commentsCount") or 0),
                "duration": int(r.get("videoDuration") or 0),
                "url": r.get("url") or "",
                "timestamp": r.get("timestamp") or "",
            }
        )
    return posts


def _pick_default_keyword(niche_config: List) -> str:
    if not niche_config:
        return "instagram marketing"
    n0 = niche_config[0]
    k_de = n0.get("keywords_de") or []
    k_en = n0.get("keywords") or []
    if k_de:
        return str(k_de[0])
    if k_en:
        return str(k_en[0])
    return str(n0.get("name") or "content creator")


def _collect_hashtag_queries(niches: List, max_q: int = 6) -> List[str]:
    """Topic hashtags from niche_config (auto-profile). Used as reel-search keywords."""
    out: List[str] = []
    seen: set[str] = set()
    for n in niches or []:
        if not isinstance(n, dict):
            continue
        for key in ("hashtags", "hashtags_de"):
            for h in n.get(key) or []:
                s = str(h).strip().lstrip("#")
                if not s:
                    continue
                low = s.lower()
                if low in seen:
                    continue
                seen.add(low)
                out.append(s)
                if len(out) >= max_q:
                    return out
    return out


def _collect_keywords(niches: List, payload: Dict[str, Any]) -> List[str]:
    """Same idea as scripts/competitor-batch-discover.js (--keywords / --lang)."""
    raw = payload.get("keywords")
    if isinstance(raw, list) and len(raw) > 0:
        out = [str(x).strip() for x in raw if str(x).strip()]
        if out:
            return out
    one = payload.get("keyword")
    if one and str(one).strip():
        return [str(one).strip()]
    mode = str(payload.get("keyword_mode") or "all").lower()
    if mode not in ("all", "de", "en"):
        mode = "all"
    seen: set[str] = set()
    ordered: List[str] = []
    for n in niches or []:
        if mode in ("all", "de"):
            for k in n.get("keywords_de") or []:
                s = str(k).strip()
                if s and s not in seen:
                    seen.add(s)
                    ordered.append(s)
        if mode in ("all", "en"):
            for k in n.get("keywords") or []:
                s = str(k).strip()
                if s and s not in seen:
                    seen.add(s)
                    ordered.append(s)
    if not ordered:
        return [_pick_default_keyword(niches)]
    return ordered


def _latest_valid_baseline(supabase, client_id: str) -> Optional[dict]:
    res = (
        supabase.table("client_baselines")
        .select("*")
        .eq("client_id", client_id)
        .order("scraped_at", desc=True)
        .limit(5)
        .execute()
    )
    if not res.data:
        return None
    now = datetime.now(timezone.utc)
    for row in res.data:
        exp = row.get("expires_at")
        if not exp:
            return row
        try:
            exp_dt = datetime.fromisoformat(str(exp).replace("Z", "+00:00"))
            if exp_dt > now:
                return row
        except (ValueError, TypeError):
            return row
    return res.data[0]


def run_competitor_discovery(settings: Settings, job: Dict[str, Any]) -> None:
    if not settings.apify_api_token or not settings.openrouter_api_key:
        raise RuntimeError("APIFY_API_TOKEN and OPENROUTER_API_KEY required for discovery")

    supabase = get_supabase_for_settings(settings)
    job_id = job["id"]
    client_id = job["client_id"]
    payload = job.get("payload") or {}
    if isinstance(payload, str):
        import json

        payload = json.loads(payload)

    if not client_id:
        raise RuntimeError("competitor_discovery job missing client_id")

    crow = supabase.table("clients").select("*").eq("id", client_id).limit(1).execute()
    if not crow.data:
        raise RuntimeError("Client not found")
    client = crow.data[0]

    cfg = {
        "name": client["name"],
        "instagram": (client.get("instagram_handle") or "").replace("@", ""),
        "language": client.get("language") or "de",
        "niches": client.get("niche_config") or [],
        "icp": client.get("icp") or {},
    }

    limit = int(payload.get("limit") or 15)
    threshold = int(payload.get("threshold") or 60)
    posts_per = int(payload.get("posts_per_account") or 8)
    keywords_list = _collect_keywords(cfg["niches"], payload)

    products = client.get("products") or {}
    raw_seeds = products.get("competitor_seeds") if isinstance(products, dict) else []
    if not isinstance(raw_seeds, list):
        raw_seeds = []
    seed_usernames = [str(s).strip().lstrip("@") for s in raw_seeds if str(s).strip()]

    search_input_shape = {"search": "<keyword>", "searchType": "user", "resultsLimit": limit * 2}
    progress: Dict[str, Any] = {
        "pipeline": "competitor_discovery",
        "phase": "searching",
        "apify": {
            "search_actor": SEARCH_ACTOR,
            "reel_actor": REEL_ACTOR,
            "reference": "services/apify.py — same actor IDs as scripts/competitor-discovery.js",
        },
        "openrouter_model": settings.openrouter_model,
        "keywords_planned": keywords_list,
        "competitor_seeds": seed_usernames,
        "params": {
            "limit": limit,
            "threshold": threshold,
            "posts_per_account": posts_per,
            "apify_user_search_input": search_input_shape,
            "apify_reel_scrape_input": {"username": ["<instagram_username>"], "resultsLimit": posts_per},
        },
        "seed_runs": [],
        "keyword_runs": [],
        "hashtag_runs": [],
    }
    supabase.table("background_jobs").update({"result": progress}).eq("id", job_id).execute()

    seen_usernames: set[str] = set()
    accounts: List[dict] = []
    excl = cfg["instagram"]
    for su in seed_usernames:
        acc = fetch_instagram_user_by_username(settings.apify_api_token, su, exclude_username=excl)
        found = False
        if acc:
            u = (acc.get("username") or "").lower()
            if u and u not in seen_usernames:
                seen_usernames.add(u)
                accounts.append(acc)
                found = True
        progress["seed_runs"].append({"username": su, "resolved": found})
        supabase.table("background_jobs").update({"result": dict(progress)}).eq("id", job_id).execute()

    for kw in keywords_list:
        batch = _discover_by_keyword(
            settings.apify_api_token,
            kw,
            limit,
            cfg["instagram"],
        )
        for a in batch:
            u = (a.get("username") or "").lower()
            if u and u not in seen_usernames:
                seen_usernames.add(u)
                accounts.append(a)
        progress["keyword_runs"].append(
            {
                "keyword": kw,
                "apify_search_input": {"search": kw, "searchType": "user", "resultsLimit": limit * 2},
                "accounts_returned_this_keyword": len(batch),
                "unique_accounts_merged_so_far": len(accounts),
            }
        )
        progress["phase"] = "evaluating" if accounts else "searching"
        supabase.table("background_jobs").update({"result": dict(progress)}).eq("id", job_id).execute()

    if not accounts:
        progress["phase"] = "completed"
        progress["message"] = "No accounts found for any keyword"
        progress["evaluated"] = 0
        progress["competitors_saved"] = 0
        supabase.table("background_jobs").update(
            {
                "status": "completed",
                "completed_at": datetime.now(timezone.utc).isoformat(),
                "result": progress,
            }
        ).eq("id", job_id).execute()
        return

    niche_profile = _build_niche_profile(cfg)

    baseline_row = _latest_valid_baseline(supabase, client_id)
    baseline_for_eval = None
    if baseline_row:
        baseline_for_eval = {
            "p90_views": baseline_row.get("p90_views") or 0,
            "median_views": baseline_row.get("median_views") or 0,
            "p10_views": baseline_row.get("p10_views") or 0,
        }

    evaluated = 0
    saved = 0
    cost_hint = 0.0

    for account in accounts:
        account["_client_lang"] = cfg["language"]
        posts = _scrape_account_posts(
            settings.apify_api_token,
            account["username"],
            posts_per,
            account.get("_latestPosts"),
        )
        if len(posts) < 2:
            continue
        evaluated += 1
        total_views = sum(p["views"] for p in posts)
        avg_views = round(total_views / len(posts))
        avg_likes = round(sum(p["likes"] for p in posts) / len(posts))
        avg_comments = round(sum(p["comments"] for p in posts) / len(posts))

        prompt = _build_relevance_prompt(niche_profile, account, posts)
        analysis = analyze_relevance(
            settings.openrouter_api_key,
            prompt,
            settings.openrouter_model,
        )
        cost_hint += 0.001

        rel_score = int(analysis.get("relevance_score") or 0)
        if rel_score < threshold:
            time.sleep(1)
            continue

        disc: Dict[str, Any] = {
            "username": account["username"],
            "profileUrl": account["profileUrl"],
            "followers": account["followers"],
            "avgViews": avg_views,
            "avgLikes": avg_likes,
            "avgComments": avg_comments,
            "relevance": analysis,
        }

        row = {
            "client_id": client_id,
            "username": account["username"],
            "profile_url": account["profileUrl"],
            "followers": account["followers"],
            "avg_views": avg_views,
            "avg_likes": avg_likes,
            "avg_comments": avg_comments,
            "language": analysis.get("language"),
            "content_style": analysis.get("content_style"),
            "topics": analysis.get("primary_topics") or [],
            "reasoning": analysis.get("reasoning"),
            "relevance_score": rel_score,
            "discovery_job_id": job_id,
        }

        if baseline_for_eval:
            scored = evaluate_competitor(disc, baseline_for_eval, cfg["language"])
            row.update(
                {
                    "performance_score": scored["performance_score"],
                    "language_bonus": scored["language_bonus"],
                    "composite_score": scored["composite_score"],
                    "tier": scored["tier"],
                    "tier_label": scored["tier_label"],
                }
            )

        existing = (
            supabase.table("competitors")
            .select("id")
            .eq("client_id", client_id)
            .eq("username", account["username"])
            .limit(1)
            .execute()
        )
        if existing.data:
            row["id"] = existing.data[0]["id"]
        else:
            row["id"] = generate_competitor_id()

        supabase.table("competitors").upsert(row, on_conflict="client_id,username").execute()
        saved += 1
        time.sleep(1)

    progress["phase"] = "completed"
    progress["accounts_discovered"] = len(accounts)
    progress["evaluated"] = evaluated
    progress["competitors_saved"] = saved
    progress["cost_usd_approx"] = round(cost_hint, 4)

    supabase.table("background_jobs").update(
        {
            "status": "completed",
            "completed_at": datetime.now(timezone.utc).isoformat(),
            "result": progress,
        }
    ).eq("id", job_id).execute()
