# Reel provenance (Intelligence UX)

**Contract:** Every `ScrapedReelRow` returned from the Content API may include a `provenance` object. It is attached in `backend/services/reel_metrics.py` via `normalize_scraped_reel_row_for_api` (see `backend/services/reel_provenance.py`).

**Why both backend and frontend?** The server is the source of truth for API consumers; the web app’s `content-machine/src/lib/reel-provenance.ts` mirrors the same rules and is used when `provenance` is missing (older responses) or for client-only UI that never hit the API.

**Do not** show storage field names such as `client_baseline`, `outbreaker`, or `scrape` on primary surfaces; use the label and reason from `provenance` (or the helper) instead.
