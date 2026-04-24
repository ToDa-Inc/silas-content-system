# Performance Audit — Generate Page

**Date:** 2026-04-24  
**Commit:** ecc81f1  
**Stack:** Next.js (frontend) → FastAPI @ :8787 → Supabase (Postgres)  
**Pain point:** /generate page fires 3–5 independent API calls on mount, each paying full auth cost

---

## Baseline (commit ecc81f1)

Measured with `python3 measure.py --note "baseline" --runs 5`  
Direct backend hits — excludes frontend `clientApiContext()` overhead (adds ~300–600ms per call × 3–4 calls on top).

| endpoint            | cold_ms | warm_avg_ms | avg_ms | notes |
|---------------------|---------|-------------|--------|-------|
| generate_sessions   | 781     | 573         | 614    | 1st on mount (in parallel with format_digests) |
| format_digests      | 496     | 547         | 537    | 2nd on mount (parallel with sessions) |
| adapt_preview_reels | 746     | 676         | 690    | 3rd — waits for state update (cascaded) |
| reel_analyses       | 520     | 455         | 468    | source picker |

**Key observation:** warm is barely faster than cold (5–27% improvement at best).  
This means there is **zero backend caching** — every request runs 3 fresh Supabase queries  
for auth (profiles → organizations → organization_members) before touching real data.

**Realistic generate page load time (cold):**  
`max(781, 496)` [parallel pair] + `746` [cascaded] ≈ **1,527ms backend-only**  
Add frontend `clientApiContext()` waterfall × 3–4 calls: **+900–2,400ms browser-side**  
**Total perceived load: ~2.4–4 seconds on cold open.**

---

## Auth Chain Cost (confirmed)

Every endpoint call → `require_org_access` (deps.py:21-65) → 3 sequential Supabase queries:

```
SELECT id FROM profiles WHERE api_key = ?        ~50–100ms
SELECT id FROM organizations WHERE slug = ?       ~50–100ms  
SELECT id FROM organization_members WHERE ...     ~50–100ms
```

Then `resolve_client_id` (deps.py:68-83) adds a 4th:
```
SELECT id FROM clients WHERE org_id = ? AND slug = ?  ~50–100ms
```

**~200–400ms baseline auth overhead per endpoint, uncached, every time.**

Frontend side adds `clientApiContext()` (api-client.ts:80-109):
```
supabase.auth.getUser()                  ← Supabase network call
fetch("/api/session/active-client")      ← Next.js API route  
resolveTenancy(...)                      ← uses both above
supabase.from("profiles").select(...)    ← another Supabase query for api_key
```
This runs fresh on every `clientApiHeaders()` call — no cache, no deduplication.

---

## Hypotheses (ranked by expected impact)

### H1 — Cache `require_org_access` on backend
**Category:** No caching  
**Impact:** High — eliminates 3 Supabase queries per endpoint per request  
**Approach:** In-process LRU cache keyed on `(api_key, org_slug)`, TTL 60s  
**Expected gain:** 150–300ms per endpoint (cold drops to ~300–400ms, warm to ~100–200ms)  
**Status:** pending

### H2 — Cache `clientApiContext()` on frontend  
**Category:** No caching  
**Impact:** High — eliminates 3–4 redundant full auth chains per page load  
**Approach:** Module-level Promise cache, invalidated on Supabase `onAuthStateChange`  
**Expected gain:** 900–2,400ms off perceived load time (browser-side)  
**Status:** pending

### H3 — Pass resolved headers into parallel API calls (generate page)  
**Category:** Sequential I/O  
**Impact:** Medium — `generationListSessions` and `fetchFormatDigests` each call `clientApiHeaders()` independently after `refreshContext()` already resolved the same data  
**Approach:** Accept pre-resolved headers as optional param in API functions  
**Expected gain:** 2 fewer `clientApiContext()` chains (~600ms browser-side)  
**Status:** pending

### H4 — Parallelize backend auth queries  
**Category:** Sequential I/O  
**Impact:** Medium — profiles + organizations queries are independent, could run concurrently  
**Approach:** `asyncio.gather` in `require_org_access`  
**Expected gain:** ~50–100ms per endpoint  
**Status:** pending

### H5 — Remove cascaded useEffect for adapt_preview_reels  
**Category:** Frontend waterfall  
**Impact:** Medium — adapt_preview_reels fires only after clientSlug/orgSlug state is set, adding a full extra render cycle  
**Approach:** Include in the first `Promise.all` using context from `refreshContext()`  
**Expected gain:** ~1 render cycle saved (~100ms+ depending on React schedule)  
**Status:** pending

---

## Fix Log

### Fix 1 — H1 + H2: Backend TTL cache + Frontend context cache
**Commit:** ecc81f1 (same — code change, not committed yet)  
**Files:** `backend/core/deps.py`, `content-machine/src/lib/api-client.ts`

**Backend change:** Added 60s TTL in-process cache to `require_org_access` (key: `api_key + org_slug → org_id`) and `resolve_client_id` (key: `org_id + client_slug → client_id`). No new dependencies — plain dict + `time.monotonic()`. Cold hit still pays full cost; all warm hits skip the 3–4 Supabase queries entirely.

**Frontend change:** Added 5-min Promise cache to `clientApiContext()`. The in-flight Promise is stored immediately (before resolution) so concurrent callers on the same tick share one chain. Invalidated on `supabase.auth.onAuthStateChange`. Bypassed for explicit `orgSlug` overrides.

| endpoint            | baseline cold | after cold | baseline warm | after warm | warm improvement |
|---------------------|--------------|------------|---------------|------------|-----------------|
| generate_sessions   | 781ms        | 278ms      | 573ms         | 206ms      | **-64%**        |
| format_digests      | 496ms        | 98ms       | 547ms         | 122ms      | **-78%**        |
| adapt_preview_reels | 746ms        | 443ms      | 676ms         | 320ms      | **-53%**        |
| reel_analyses       | 520ms        | 139ms      | 455ms         | 95ms       | **-79%**        |

**Decision: KEEP.** Every endpoint improved. No regressions.

**Why adapt_preview_reels still shows higher cold:** it queries a larger dataset (scraped reels) — auth overhead is gone but the data query itself takes ~300–400ms. That's real work, not waste.

**New realistic page load (cold):**  
`max(278, 98)` [parallel pair] + `443` [cascaded] ≈ **721ms backend-only** (was ~1,527ms)  
Warm: `max(206, 122)` + `320` ≈ **526ms** (was ~1,249ms)

---

## Final Summary

*(fill in after all fixes)*
