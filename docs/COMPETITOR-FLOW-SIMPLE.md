# Competitors — simple model

**Principle:** Two ways a competitor gets into the list. Nothing else needs naming.

---

## 1. Where competitors come from

| How | What happens |
|-----|----------------|
| **You add them** | Paste `@handle` or profile URL → preview → **Add to tracking**. Optional **added_by** (free text: `"Silas"`, `"Dani"` — not tied to auth). |
| **The system finds them** | **Bio search** (identity-style keywords) + **hashtag pages** using hashtags from **client auto-profile** (same AI that profiles the client at onboarding — no extra config). |

**No “seeds”.**  
Old docs that say “competitor seeds” mean: **competitors you already knew at onboarding**. That is the **same action** as “add manually” — you paste handles. It is not a separate system.

---

## 2. Discovery (when it runs)

- Run at **onboarding** + when the user hits **“find competitors”** (or similar). **Not** weekly by default.
- **Inputs:** client niche + **hashtags from auto-profile** + keywords from niche config (for bio search).
- **Output:** new rows in `competitors`, **deduped by username** (`UNIQUE (client_id, username)`). If the username is already there (because someone added it manually), **skip** — one row per account.

---

## 3. What we do **not** need

- **No** `source_detail`, **no** strategy columns, **no** “seed_network” vs “keyword_bio” bookkeeping in the product model.
- **No** separate “seed” table or config key — use **manual add** for “we already know these 2–3 accounts” at onboarding.
- **Preview:** if the user **Discard**s, **throw away** the preview. Re-scrape next time. No caching.

---

## 4. Optional: one field for “who added”

- **`added_by` text, nullable** — set when a human adds via paste; **null** when the row came from automated discovery.  
- That’s enough to tell “human-picked” vs “system-found” without a `source` enum and without `source_detail`.

---

## 5. Hashtags (Strategy: hashtag pages)

- **Source:** auto-profile output for the client (already generated at onboarding).  
- **Use:** scrape top posts for those hashtags → collect account usernames → same relevance + dedup flow as today.

---

## 6. Tiers / scores

- **Product:** keep it simple in the UI — show **similarity or relevance** and **avg views**; avoid burying people in tier jargon unless it still helps internally.
- **Implementation:** existing `relevance_score` / composite logic can stay or be simplified later — **not** part of this naming doc.

---

## 7. One sentence

**Competitors are either pasted in or found by bio + hashtag discovery; onboarding “known” accounts are just the first pasted adds — not seeds.**

---

## 8. Implementation (repo)

| Piece | Location |
|-------|----------|
| `competitors.added_by` migration | `backend/sql/phase1c_competitors_added_by.sql` |
| Preview + add (paste handle) | `POST /api/v1/clients/{slug}/competitors/preview`, `.../competitors/add` — `services/competitor_manual.py` |
| Discovery: bio + seeds + **hashtag reel search** | `jobs/competitor_discovery.py` + `services/apify.run_keyword_reel_search` |
| Hashtags in niche config | `client_auto_profile` prompt adds `hashtags` / `hashtags_de` per niche |
| UI | `AddCompetitorButton`, badges in `CompetitorsList` |
