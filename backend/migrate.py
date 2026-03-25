#!/usr/bin/env python3
"""
One-time migration: JSON on disk → Supabase Phase 1 tables.

Usage (from repo root):
  cd backend && pip install -r requirements.txt
  cp ../.env.example ../.env   # repo root — fill SUPABASE_* and MIGRATE_* / DEFAULT_ORG_SLUG for this script
  python migrate.py

Reads:
  config/clients/{slug}.json — default slug conny-gfrerer
  data/niches/{slug}/baseline.json (optional)
  data/niches/{slug}/current-competitors.json (optional)
"""

from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client

from core.id_generator import (
    generate_baseline_id,
    generate_client_id,
    generate_competitor_id,
    generate_org_id,
)

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_CLIENT_SLUG = "conny-gfrerer"


def load_json(path: Path):
    if not path.exists():
        return None
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def main() -> None:
    load_dotenv(REPO_ROOT / ".env")
    load_dotenv(Path(__file__).parent / ".env", override=True)
    load_dotenv(REPO_ROOT / "config" / ".env", override=True)
    load_dotenv(REPO_ROOT / ".env", override=True)  # last wins — same as core.config.Settings

    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    org_slug = os.environ.get("DEFAULT_ORG_SLUG") or os.environ.get("MIGRATE_ORG_SLUG")
    if not org_slug:
        print(
            "Set DEFAULT_ORG_SLUG or MIGRATE_ORG_SLUG to your organizations.slug (same as X-Org-Slug).",
            file=sys.stderr,
        )
        sys.exit(1)

    if not url or not key:
        print("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in backend/.env", file=sys.stderr)
        sys.exit(1)

    supabase = create_client(url, key)

    # Organization
    org_res = supabase.table("organizations").select("id").eq("slug", org_slug).execute()
    if org_res.data:
        org_id = org_res.data[0]["id"]
        print(f"Using existing org: {org_slug} ({org_id})")
    else:
        ins = (
            supabase.table("organizations")
            .insert(
                {
                    "id": generate_org_id(),
                    "name": os.environ.get("MIGRATE_DEFAULT_ORG_NAME", "Agency"),
                    "slug": org_slug,
                    "plan": "agency",
                }
            )
            .execute()
        )
        org_id = ins.data[0]["id"]
        print(f"Created org: {org_slug} ({org_id})")

    client_path = REPO_ROOT / "config" / "clients" / f"{DEFAULT_CLIENT_SLUG}.json"
    raw = load_json(client_path)
    if not raw:
        print(f"Missing client config: {client_path}", file=sys.stderr)
        sys.exit(1)

    slug = raw.get("client_id", DEFAULT_CLIENT_SLUG)
    niche_config = raw.get("niches", [])
    icp = raw.get("icp", {})
    products = raw.get("products", {})
    instagram = raw.get("instagram") or raw.get("instagram_handle")
    language = raw.get("language", "de")
    name = raw.get("name", slug)

    client_row = {
        "org_id": org_id,
        "slug": slug,
        "name": name,
        "instagram_handle": instagram,
        "language": language,
        "niche_config": niche_config,
        "icp": icp,
        "products": products if isinstance(products, dict) else {},
        "is_active": True,
    }

    existing = (
        supabase.table("clients")
        .select("id")
        .eq("org_id", org_id)
        .eq("slug", slug)
        .execute()
    )
    if existing.data:
        client_id = existing.data[0]["id"]
        supabase.table("clients").update(client_row).eq("id", client_id).execute()
        print(f"Updated client: {slug} ({client_id})")
    else:
        ins = (
            supabase.table("clients")
            .insert({**client_row, "id": generate_client_id()})
            .execute()
        )
        client_id = ins.data[0]["id"]
        print(f"Inserted client: {slug} ({client_id})")

    # Baseline (optional)
    baseline_path = REPO_ROOT / "data" / "niches" / slug / "baseline.json"
    baseline = load_json(baseline_path)
    if baseline and isinstance(baseline, dict):
        views = baseline.get("views") or {}
        thresh = baseline.get("thresholds") or {}
        scraped_at = baseline.get("scrapedAt")
        try:
            scraped_dt = datetime.fromisoformat(scraped_at.replace("Z", "+00:00")) if scraped_at else datetime.now(timezone.utc)
        except (TypeError, ValueError):
            scraped_dt = datetime.now(timezone.utc)
        expires_at = scraped_dt + timedelta(days=7)

        bl_row = {
            "id": generate_baseline_id(),
            "client_id": client_id,
            "avg_views": views.get("avg"),
            "median_views": views.get("median"),
            "max_views": views.get("max"),
            "p90_views": thresh.get("blueprintViews") or views.get("p90"),
            "p10_views": thresh.get("peerViews") or views.get("p10"),
            "avg_likes": (baseline.get("likes") or {}).get("avg"),
            "reels_analyzed": baseline.get("reelsCount"),
            "scraped_at": scraped_dt.isoformat(),
            "expires_at": expires_at.isoformat(),
        }
        supabase.table("client_baselines").insert(bl_row).execute()
        print(f"Inserted baseline from {baseline_path}")
    else:
        print(f"No baseline file at {baseline_path} (skipped)")

    # Current competitors (optional)
    cc_path = REPO_ROOT / "data" / "niches" / slug / "current-competitors.json"
    cc = load_json(cc_path)
    if cc and isinstance(cc, dict):
        merged: list[dict] = []
        for key in ("blueprints", "strong", "peers"):
            merged.extend(cc.get(key) or [])

        for c in merged:
            scores = c.get("scores") or {}
            topics = c.get("topics") or []
            if isinstance(topics, str):
                topics = [topics]
            comp_row = {
                "client_id": client_id,
                "username": c.get("username"),
                "profile_url": c.get("profileUrl"),
                "followers": c.get("followers"),
                "avg_views": c.get("avgViews"),
                "avg_likes": c.get("avgLikes"),
                "language": c.get("language"),
                "content_style": c.get("contentStyle"),
                "topics": topics,
                "reasoning": c.get("reasoning"),
                "relevance_score": scores.get("relevance"),
                "performance_score": scores.get("performance"),
                "language_bonus": scores.get("languageBonus") or 0,
                "composite_score": scores.get("composite"),
                "tier": c.get("tier"),
                "tier_label": c.get("tierLabel"),
                "discovery_job_id": None,
                "last_evaluated_at": datetime.now(timezone.utc).isoformat(),
            }
            if not comp_row["username"]:
                continue
            existing_c = (
                supabase.table("competitors")
                .select("id")
                .eq("client_id", client_id)
                .eq("username", comp_row["username"])
                .limit(1)
                .execute()
            )
            if existing_c.data:
                comp_row["id"] = existing_c.data[0]["id"]
            else:
                comp_row["id"] = generate_competitor_id()
            supabase.table("competitors").upsert(comp_row, on_conflict="client_id,username").execute()

        print(f"Migrated {len(merged)} competitors from {cc_path}")
    else:
        print(f"No current-competitors at {cc_path} (skipped)")

    print("Done.")


if __name__ == "__main__":
    main()
