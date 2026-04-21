"""One-off: run keyword_reel_similarity for a client slug (uses .env)."""
from __future__ import annotations

import argparse
import os
import sys

from core.config import get_settings
from core.database import get_supabase_for_settings
from core.id_generator import generate_job_id
from jobs.keyword_reel_similarity import run_keyword_reel_similarity


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("slug", help="clients.slug e.g. conny-gfrerer")
    p.add_argument(
        "--max-keywords",
        type=int,
        default=12,
        metavar="N",
        help="Cap keyword count (1–12). Resolver order unchanged; lower = fewer Apify searches.",
    )
    p.add_argument(
        "--apify-token",
        default=None,
        help="Override APIFY_API_TOKEN for this run only (avoid committing; prefer env).",
    )
    p.add_argument(
        "--days",
        type=int,
        default=None,
        metavar="N",
        help="Per-run DB recency cutoff (days). Should match --search-window. Defaults to client/job defaults.",
    )
    p.add_argument(
        "--search-window",
        default=None,
        choices=["last-1-day", "last-2-days", "last-1-week", "last-1-month"],
        help="Per-run Sasky actor date window. last-1-week = 7 days. Defaults to client/job defaults.",
    )
    args = p.parse_args()

    if not (1 <= args.max_keywords <= 12):
        print("ERROR: --max-keywords must be between 1 and 12", file=sys.stderr)
        sys.exit(1)
    if args.days is not None and not (1 <= args.days <= 90):
        print("ERROR: --days must be between 1 and 90", file=sys.stderr)
        sys.exit(1)

    if args.apify_token:
        os.environ["APIFY_API_TOKEN"] = args.apify_token.strip()
        get_settings.cache_clear()

    settings = get_settings()
    if not settings.supabase_url or not settings.supabase_service_role_key:
        print("ERROR: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing", file=sys.stderr)
        sys.exit(1)
    if not settings.apify_api_token:
        print("ERROR: APIFY_API_TOKEN (or APIFY_API_KEY) missing", file=sys.stderr)
        sys.exit(1)
    if not settings.openrouter_api_key:
        print("ERROR: OPENROUTER_API_KEY missing", file=sys.stderr)
        sys.exit(1)

    supabase = get_supabase_for_settings(settings)
    r = (
        supabase.table("clients")
        .select("id, org_id, slug, name")
        .eq("slug", args.slug)
        .limit(1)
        .execute()
    )
    if not r.data:
        print("ERROR: No client with slug", repr(args.slug), file=sys.stderr)
        sys.exit(1)

    row = r.data[0]
    client_id = row["id"]
    org_id = row.get("org_id") or ""
    if not org_id:
        print("ERROR: client has no org_id", file=sys.stderr)
        sys.exit(1)

    payload: dict = {"max_keywords": args.max_keywords}
    if args.days is not None:
        payload["days"] = args.days
    if args.search_window:
        payload["search_window"] = args.search_window

    job_id = generate_job_id()
    supabase.table("background_jobs").insert(
        {
            "id": job_id,
            "org_id": org_id,
            "client_id": client_id,
            "job_type": "keyword_reel_similarity",
            "payload": payload,
            "status": "queued",
        }
    ).execute()

    job = {"id": job_id, "client_id": client_id, "payload": payload}
    print(
        f"Starting keyword_reel_similarity job_id={job_id} client={args.slug} ({row.get('name')}) "
        f"max_keywords={args.max_keywords} days={args.days or 'default'} "
        f"search_window={args.search_window or 'default'}"
    )
    run_keyword_reel_similarity(settings, job)
    print("Finished OK — background_jobs.id =", job_id)


if __name__ == "__main__":
    main()
