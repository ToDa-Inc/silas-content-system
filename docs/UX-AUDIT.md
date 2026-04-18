# UX Audit — Silas Content System

> Deep frontend / UX assessment of the dashboard, intelligence, and generation flows for the infoproducer-content-manager persona.
> Goal of the persona: see what's going viral in the niche → spot patterns → replicate as a script / video / caption for their client.
>
> This doc captures the full audit **plus the founder's prioritization decisions** so the team knows what we're acting on, what we're parking, and what's been explicitly de-scoped.

---

## TL;DR — the diagnosis

The product idea is sharp: "feed me viral competitor reels in my niche, tell me why they worked, then help me replicate them as a script + caption + video." The intelligence engine and generation pipeline behind the scenes are powerful. But **the frontend is leaking the engine into the user's face**.

The team has already written the cure for this in `INTELLIGENCE-GUIDE.md` ("Build for content creators, not data scientists" — concrete language rules, four-source model, "What happened" daily hook). The current UI **violates almost every rule of that guide**.

A content manager opening this app today sees:
- 3+ different "sync" buttons,
- 4+ different ways to start a video that converge on the same generation pipeline,
- 5+ scoring vocabularies (`composite_score`, `relevance_score`, `outlier_ratio`, `outbreaker_ratio`, `trending_ratio`, `Silas score`),
- error messages that mention `SUPABASE_SERVICE_ROLE_KEY` and `organization_members` rows,
- model/provider names like "created image with gpt-5 via openrouter" leaking into the create flow,
- and no clear answer to the only question they came to ask: **"What should I make today, and where do I click to make it?"**

---

## Decisions in this audit (founder review)

What's **in scope** to act on:

- ✅ **Vocabulary standardization** — one `lib/copy.ts`, kill banned words. (Note: **"Client DNA" is keeper vocabulary** — vivid, clear, not engineering jargon.)
- ✅ **Sync collapse** — one button, one modal, defaults to "everything".
- ✅ **Dashboard "Heating up" rework — confirmed Option B**: re-source to competitor breakouts in the last 24h, with `Recreate` CTA per row. Dashboard panel now answers "what should I make today" directly.
- ✅ **Generate page cleanup** *(shipped)*:
  - Remove "Adapt an English script" (`script_adapt`).
  - **Composer model v2 — two-mode segmented control** (replaces v1 unified composer, which kept feeling like two products in one box):
    - `[ Start from an idea | Recreate a reel ]` segmented control at the top, persisted in `localStorage`. `?url=…` deep-link forces Recreate.
    - **Idea mode** = textarea ("What's the idea?") + format pills with niche reel counts inline (`Talking head · 41 in your niche`). Empty box + Auto → AI proposes idea+format. Empty box + explicit format → `format_pick`. Free text → `idea_match`.
    - **Recreate mode** = single URL input ("Which reel?") + 4-thumb "Quick picks" teaser of top breakouts + "Browse breakouts →" link to `/intelligence/breakouts`. No format pills (the source reel sets the structure).
    - Optional focus note collapsed behind `+ Add a focus note`.
    - Killed the standalone "Suggested competitor reels" grid and the "Styles from your niche" disclosure — both folded into the right mode.
  - Blueprint angle (URL-recreate first angle) still shows green badge + one-line explanation. Verified on the angles step.
  - **Blueprint badge ⓘ tooltip** *(shipped)* — focus/hover popover on the green pill lists what the LLM preserves (format & beats / hook mechanism / topic arc / payoff) vs swaps (language / names & setting / examples / Voice — Client DNA). Mirrors the `FAITHFUL BLUEPRINT` prompt contract in `content_generation.py` so the UI promise matches what the model is actually instructed to do.
- ✅ **Recent sessions → visual catalogue + Done recap** *(shipped)*:
  - Recent sessions panel inside Generate now adapts per row instead of one-size-fits-all:
    - **In‑progress sessions** stay compact (date · status pill · format pill · angle title) — there's nothing to preview yet, so no fake thumbnail.
    - **Done sessions** (`render_status === "done"` and `thumbnail_url` present) render as visual cards: 9:16 cover thumbnail (~80px) + angle title + 2-line caption snippet + Done/Format pills + date.
    - Same `generationListSessions` data, no backend work, no new endpoints, no new sidebar tab.
  - **Pinned deliverable recap** at the very top of the visual-formats workspace when a session is Done. Shows cover thumbnail + caption + Copy caption / Download MP4 / Preview actions, so reopening a finished session lands on the result instead of forcing the user to scroll past four build cards. The Output card below stays unchanged (publish hint still lives there); the recap is the at-a-glance summary, Output is the full deliverable detail.
  - Forward-compatible: same card pattern is the natural building block for the future Scheduling queue / approval view.
- ✅ **Post preview modal** *(shipped — replaces in-place caption expand)*:
  - New reusable `PostPreviewModal` (`components/post-preview-modal.tsx`) — full-deliverable view in one modal: 9:16 video player with controls (cover as poster), full caption (no clamp, scrollable), hashtag pills, Copy caption, Download MP4, optional `Open session →` link. Backdrop + ESC close, body-scroll-locked, matches existing `ConfirmDialog` modal pattern.
  - **Generate workspace recap** — the brittle ref-measured "Show more / Show less" caption toggle is replaced with a primary `Preview post` button (kept the line-clamp-3 caption snippet inline; the modal carries the full text). Solves the "I can't see the expanded caption" gap directly because the modal always shows the whole thing regardless of length.
  - **`/media` Renders cards** — the bare `▶` link (which opened the raw MP4 in a new tab with no caption / no context) becomes a `Preview` button that opens the same modal. Download MP4 stays for the quick file-grab job.
  - **`/media` Covers cards** — same `Preview` button. Modal falls back to thumbnail-only when no `rendered_video_url` exists, so cover-only sessions still get the full-caption view.
  - One modal, three surfaces, zero new endpoints — all data already on the session row.
- ✅ **Library (`/media`) — close the loop back to sessions** *(shipped)*:
  - Renders + Covers cards now show a 3-line caption snippet under the title, so the grid reads as "finished posts" instead of "anonymous file thumbnails".
  - Clicking the cover thumbnail (or the new `Open session →` link) routes to `/generate?session={id}`, so users can go from "browsing assets" → "edit / re-publish this one" without copying the session ID.
  - No new tabs, no new endpoints — the data was already on each session row.
- ✅ **Video pipeline cleanup — Visual & Render merged** *(shipped)*:
  - Old: Step 2 Background (3 stacked "Or:" sections — AI / image / clip) + Step 3 Render (a card that mostly displayed "Set a background first").
  - New: **Step 2 Visual & render** — one card. Tab control at top (`AI image | Client photo | Stock clip`), shared 9:16 preview that always reflects the saved background regardless of active tab, per-tab control panel below. Render CTA + render status (rendering / failed / done) all live in the card's footer divider, so the action sits next to the decision that unblocks it.
  - `b_roll_reel` format skips the tabs (only one valid source) and shows the clip picker directly.
  - Steps renumbered downstream: Cover → Step 3, Output → Step 4. Talking-head flow untouched (no render branch).
- ✅ **Intelligence further simplification** — see §7. Specifically: rename the two tabs to plain English (or drop the tabs entirely), collapse the toolbar to one labeled `Sync` button, merge the two teaser cards.
- ✅ **Intelligence Reels page cleanup** *(shipped)*:
  - **Niche-analysis rendering bug fixed** — niche-keyword reels were rendering as `0/50 · Weak` because the frontend was forcing them through the Silas-score formatter even though their analysis writes to a different payload (`full_analysis_json.keyword_similarity` — verdict, similarity_score, matched_keywords, what_matches/differs, adaptation_angle). Diagnosed from a real DB row: `total_score=0` was just the SQL default, every Silas-score field was null, `prompt_version=null`, the real output was in the keyword_similarity block. Added `isNicheMatchOnly()` guard in the table that detects `source === "keyword_similarity"` AND no real Silas score, then renders a `Niche match` pill + `View analysis` instead of a fake score. The detail modal now branches: title `Niche match` (vs `Silas analysis`), shows similarity score + verdict + matched-keyword chips + what-matches/what-differs/how-to-adapt sections, hides the empty Silas criterion grid.
  - **Column header rename**: `SILAS` → `Score` + tooltip ("Silas score 0–100. Niche reels show a match instead of a score."), `Perf / Match` → `Signal` + tooltip ("N× = beat the account's average. N% match = matches your niche keywords.").
  - **Pill rename**: `Niche` → `Niche match` + tooltip explaining provenance.
  - **Score cell branching**: analyzed Silas / analyzed niche / not-scored-yet (`Not scored yet` caption above Analyze button) / no-link (`—` with tooltip "No post link saved — re-sync the source to enable analysis").
  - **Microcopy purge**: dropped the `prompt_version · model_used` line ("silas_v2_breakout · google/gemini-3-flash-preview") from the analysis modal footer per audit §1. Replaced with a clean "Analyzed Apr 17, 2:27 PM" timestamp.
  - **Visual de-emphasis fixes**: un-muted the `Likes` column (was rendered in faded text for no clear reason — Likes is normal data). Saves/Shares cells now render `0` and `—` in muted color so the rare populated values pop.
  - **Sort fix**: `Signal` column sort now falls back to `similarity_score` per row when `outlier_ratio` is null, so sorting Signal no longer buries every niche reel at the bottom.
  - **Source filter pills loading state**: extracted `SourceFilterPills` client component using Next 16's `useLinkStatus`. Each pill now renders an inline spinner during navigation pending state — the data refetch was already server-side, the UI was just silent during the round-trip.
- ✅ **Intelligence sync collapse + What happened cleanup** *(shipped)*:
  - **One labeled `Sync` button** in the toolbar (replaces the previous 3 unlabeled icons: full-sync RefreshCw, niche Radar, analyze Link2). Opens the existing `SyncDataModal` (gold standard from Dashboard) so Dashboard and Intelligence now share the exact same sync UX.
  - **`Last synced X ago` / `Never synced` indicator** sits under the Sync button on `/intelligence` and `/intelligence/reels`, sourced from `BaselineRow.scraped_at` (already fetched, no backend work). Turns amber + reads "out of date" past 24h. Re-ticks every minute while the page is open.
  - **`SyncDataModal` upgraded**: default mode is now `Everything (Recommended)` (was `My reels only`), radio order reorganized so the recommended option leads. Added an `Also pull niche keyword reels` checkbox (off by default) — replaces the standalone Radar icon. Auto-runs `/recompute-breakouts` after every sync (silent), so the user never has to think about "recompute" as a separate concept. Title renamed `Update data → Sync`, CTA `Start update → Sync now`. Removed all infra-leaky copy ("Apify", "API", "uvicorn", "queued for a worker process") per audit §2.
  - **Cache invalidation bug fix**: the toolbar's old `runFullSync()` only called `router.refresh()`, leaving the 3-min `_activityCache` in `WhatHappenedSection` serving pre-sync data — silent staleness. Sync completion now dispatches a `silas:intelligence-synced` window event; `WhatHappenedSection` listens and bumps `activityRefreshKey`, so the user sees fresh activity the instant the modal closes.
  - **Inline recompute button removed** from the `What happened` header (recompute is now automatic). The standalone button stays on `/intelligence/breakouts` where it's still the right tool for re-flagging without a full sync.
  - **`+ Analyze a reel` link moved** from the toolbar to a small text button next to `View all reels →` in the `What happened` footer — it's a one-off action, not a routine one (per §7b).
  - **Two teaser cards merged into one inline strip**: the bottom-of-page `Competitor breakouts` + `Competitors` cards collapse to a single `nav` with `5 competitor breakouts · 14 competitors tracked` (per §7c). Less visual weight, same destinations.
  - Out of scope (still pending): per-competitor `Sync reels [N▾]` row button → `…` menu (§4 / §7f), `/intelligence/competitors` page's separate `SectionSyncButton` (cleanup follow-up), multiplier badge standardization (§7d), `/intelligence/reels` filter chip restructure (§7e).
- ✅ **Microcopy purge** — kill all engineering / model / provider mentions ("created image with gpt-5 via openrouter", "Apify", "FastAPI", "RLS", env var names, table names).
- ✅ **Error message rewrite** — no env vars, no table names in user-visible UI.

What's **explicitly de-scoped (for now)**:

- ❌ Sidebar restructure → **keep current sidebar**.
- ❌ Dashboard / Intelligence page consolidation → **keep both as separate pages**.
- ❌ Session persistence / "Continue where I left off" → too complex relative to value right now.
- ❌ "Or start from your niche playbook" disclosure on Generate → too much for v1, just ship the simple composer.

---

## 1. Vocabulary chaos — every screen invents a new word for the same thing

The strategy guide explicitly bans this jargon. The UI ignores its own rules. A non-exhaustive map of synonyms a single user encounters in one session:

| Concept | Words used today |
|---|---|
| Pull fresh data | "Sync", "Update my reels", "Update data", "Refresh baseline", "Sync reels", "Refresh styles", "Re-roll", "Refresh format digests", "Recompute" |
| A reel that's overperforming | "Breakout", "Outlier", "Hot reel", "Heating up", "Trending", "Outbreaker", "Proven performer", "Top performer", "Weekly momentum" |
| Performance multiplier | `outlier_ratio`, `outbreaker_ratio`, `trending_ratio`, `composite_score`, `relevance_score`, `Silas score`, "× their average", "× peak vs their average", "× @24h" |
| Niche signals | `niche_config`, "ICP", "format digest", "synthesized patterns", `format_insights`, "niche profile", "Silas analysis" *(note: "client DNA" is the **kept** name for the brand-voice bundle — see §13)* |
| The competitor-finding action | "Discovery", "Find competitors", "Search", "Topic search", "Bio search", "Niche reels", "Hashtag pages" |

`INTELLIGENCE-GUIDE.md` already lists the bans:

> | Baseline → Your stats / Your performance |
> | Median → Average |
> | Outlier → Breakout reel / Top performer |
> | Outlier ratio → "12x their average" |
> | Discovery → Find competitors / Search |
> | Tier 1–4 → Remove. No user-facing tiers. |
> | Composite score → Remove. No user-facing scores. |
> | Scrape / Crawl → Sync |
> | Pipeline → Remove. Don't expose implementation language. |

Yet `intelligence-toolbar.tsx` ships strings like:

> "Full sync: your Instagram reels plus every tracked competitor (Apify). Competitor scrapes run in the background on the API."

`Apify`, `API`, `background`, `scrapes` — engineering vocabulary, not user vocabulary.

### Fix

- Create `lib/copy.ts` as the single owner of all user-facing strings.
- Ban string literals in `.tsx` for anything user-visible.
- Apply the strategy doc's vocabulary table verbatim.
- Pick **one** word per concept (suggestion below):

| Concept | Use this everywhere |
|---|---|
| Refresh data from Instagram | **Sync** |
| Overperforming reel | **Breakout** |
| Multiplier | **× their average** (with a one-line tooltip) |
| Brand voice / client identity (the bundle of voice, ICP, offer, do/don't) | **Client DNA** ← keeper, do not rename |
| The synthesized "what works in this niche" data (format digests + patterns) | **Niche playbook** |
| Find more competitors | **Find competitors** |

**On "Client DNA" specifically:** decision is to **keep this term**. It's evocative, the metaphor lands instantly with non-technical users ("the DNA of this brand's voice"), and it's distinct from "niche playbook" (what works generally in the niche) and "ICP" (just the target audience). Use it consistently as the label whenever we're referencing the client's voice/identity bundle.

---

## 2. Microcopy that leaks the implementation (kill all of it)

Examples to delete or rewrite:

- ❌ "Created image with gpt-5 via openrouter" → **the user does not care** which model or which provider produced an artifact. This is debug telemetry. Delete from the create-video surface.
- ❌ "Full sync: your Instagram reels plus every tracked competitor (Apify). Competitor scrapes run in the background on the API."
- ❌ "Scrape reels from your niche keywords (Instagram topic search). Saves to Intelligence metrics — runs in the background; can take several minutes."
- ❌ "Analyze one public reel by URL: downloads video, runs Silas scoring (5 criteria) — about one minute."
- ❌ "If nothing updates, upgrade the API — sync now runs inside uvicorn by default."
- ❌ "Apify is not configured on the API."
- ❌ "Lines carry each reel's last known value forward between syncs so trends stay readable · 2+ syncs recommended · One snapshot → bar comparison · Bars = latest per reel · Presets end at your newest sync; custom range uses calendar dates (snapshot timestamps in your timezone)" — a 60-word disclaimer that's longer than the chart.
- ❌ "Digest JSON copied onto this session…" tooltip in Generate header — internal data flow.
- ❌ "Synthesized patterns" → "What's working in your niche".
- ❌ "Outbreaker ratio" / "× @24h" → "3× faster than usual at 24h".
- ❌ "Format digest" / "Synthesized patterns" / "Client DNA" → one name: **"Niche playbook"**.
- ❌ "Recompute" button on Breakouts → "Refresh".

### Universal rules

1. Never name a model (`gpt-5`, `claude`, `gemini`). The user does not care **which** AI made their cover image. Telemetry like *"Created image with gpt-5 via openrouter"* is debug output bleeding into the product surface — delete it from the create flow entirely. If we want to show *something*, say "Cover generated" or nothing at all.
2. Never name a provider (`openrouter`, `apify`, `supabase`, `vapi`, `deepgram`).
3. Never name infra (`API`, `FastAPI`, `uvicorn`, `RLS`, env var names, table names).
4. Never name internal taxonomy (`tier`, `composite_score`, `outlier_ratio`).
5. If you need >15 words to explain a UI element, the UI element is wrong.

**Audit task for this purge:** grep the entire `content-machine/src` tree for the strings `gpt`, `claude`, `gemini`, `openrouter`, `apify`, `supabase`, `fastapi`, `RLS`, `composite_score`, `outlier_ratio`, `tier`, env var names. Every hit in a `.tsx` file outside of `lib/copy.ts`, type definitions, and dev-only debug panels is a deletion candidate.

---

## 3. Error messages — implementation leaking into the user's face

`intelligence/page.tsx` currently shows users:

> "We can't see a workspace for this login. The app did not find an `organization_members` row for your user (Supabase RLS + session). If you never onboarded here, start below. If you already did, confirm this project's Supabase URL/keys match the project where onboarding ran, and that your user has a membership row."

> "The server must send your profile API key to FastAPI. Ensure `SUPABASE_SERVICE_ROLE_KEY` is set in the repo `.env` (Next loads it via `next.config`), and that your user has a row in `profiles` with `api_key`…"

A paying customer should never see `SUPABASE_SERVICE_ROLE_KEY`, `organization_members`, `RLS`, `FastAPI`, `next.config`, `profiles`, `api_key` in red text. They'll close the tab.

### Fix

- One sentence per error: *"Something went wrong on our end — refresh the page or contact support."*
- Log the technical detail to Sentry / console only.
- Where the error is recoverable, give one CTA button (e.g. "Try again", "Re-onboard").

---

## 4. The "Sync" button is everywhere and means something different each time

At least **7 distinct sync triggers** across the UI:

1. `DashboardUpdateReels` — "Update my reels" (opens `SyncDataModal`)
2. `IntelligenceToolbar` "Full sync" icon — directly POSTs `/sync`, no modal
3. `IntelligenceToolbar` "Sync" labeled button on `/intelligence/reels` — same as above
4. `SectionSyncButton` on competitors page — sync just competitors
5. `ScrapeCompetitorReelsButton` on each competitor row — sync that one competitor (5/10/15/20/30 selector)
6. `NicheReelScrapeButton` (Radar icon, no label) in toolbar — sync niche topic reels
7. `StoredBreakoutsRecomputeButton` — re-compute breakouts (not a scrape but feels like one)

Two of these (#2 and #1) hit the same backend `/sync` endpoint, but **one opens a friendly modal with a radio choice ("My reels / Tracked creators / Both") and the other slams a full sync without asking** — the gentle path is on Dashboard and the dangerous path is on Intelligence, which is backwards.

`INTELLIGENCE-GUIDE.md` already says:

> "'Sync' replaces the scattered 'Refresh baseline' + per-competitor 'Scrape reels' buttons. One concept, one action."

Currently unimplemented.

### Fix (agreed)

- **One sync button.** One modal. Defaults to "yes, refresh everything."
- Use `SyncDataModal` (the 3-radio + fake-progress one) as the canonical surface — it's already the gold standard in this app.
- Keep per-row `Sync reels` on the competitor row but demote it inside an `Advanced ▾` / `…` menu.
- Niche-reel scrape and breakout-recompute become checkboxes inside the same Sync modal ("Also refresh niche keyword reels", "Also recompute breakouts"), not separate top-level buttons.
- Background it. Toast when done. Stop blocking the user with progress UIs unless they explicitly opt in.

---

## 5. Dashboard "Heating up" panel — confusing today, here's how to tweak it

### What it does today

- Title: **"Heating up"**
- Subtitle: "Your configured Instagram — largest view gains (latest vs prior snapshot)"
- Source: the **user's own reels**, ranked by view-delta since the last sync.

### Why it's confusing

A user reads "Heating up" and expects **viral reels right now in their niche** — that's the entire reason they opened the app. Instead they get their own reels with a tiny delta (a 50K reel that gained 200 views ranks above a competitor breakout doing 10× their average — because the competitor lives on a different page). With ~daily syncs the deltas are noisy and small; the panel often looks empty or pointless.

### Decision (confirmed) — Option B

- Keep the title **"Heating up"** (or rename to **"What to make today"** for even more directness — call to be made during build).
- Change the source from "user's own reels gaining views" to **competitor breakouts in the last 24h** (i.e. the same data feeding the Replicate / Outbreaker section on Intelligence).
- Each row: thumbnail + `@handle` + a clean badge like **"3× their usual 24h pace"** + a single **Recreate** CTA that deep-links into `/generate?session=…&mode=url_adapt` (which already exists today).
- This makes the dashboard's most prominent panel **directly answer the user's #1 daily question** ("what should I make today"), and clearly differentiates Dashboard from Intelligence:
  - **Dashboard** = "do this today" — short, actionable, deep-links into Generate.
  - **Intelligence** = "what's happening in your niche overall" — browseable, broader.
- Empty state when nothing qualifies: *"No fresh competitor breakouts in the last 24h. Sync to refresh, or browse all breakouts →"* with a Sync button + Intelligence link.
- The user's-own-reel "gainers since last sync" view, if we want to keep it, becomes a smaller secondary card lower on the dashboard with a clear "Your reels" header — but it's no longer the main attraction.

### Bonus: collapse the two "trending" surfaces

`DashboardHotReels` and the `WhatHappenedSection > Act now > Replicate` are conceptually adjacent. With Option B above, the dashboard panel becomes a **3-row teaser** of the Intelligence Replicate section, with a "See all →" link. One source of truth, two contexts.

---

## 6. The Generate page — too many doors into the same room

Today `generate/page.tsx` is ~1565 lines and exposes 4 source modes as equal-weight tabs:

1. **Generate video idea** (`auto_idea`) — AI proposes a topic + format
2. **Pick a content style** (`format_pick`) — choose from existing niche digests
3. **Start from an idea** (`idea_match`) — describe what you want, AI finds the format
4. **Adapt an English script** (`script_adapt`) — paste a talking-head script
5. (Hidden 5th: `url_adapt`, deep-linked from Intelligence "Recreate".)

All five converge on the same `angles → choose angle → script + caption + hooks → render` pipeline. The differences are inputs (zero / format / idea / script / URL) but the UI presents them as four different products.

### Decisions (confirmed)

- ✅ **Remove "Adapt an English script" (`script_adapt`).** The infoproducer persona doesn't paste English scripts — they describe an idea or click "Recreate" on a competitor reel. Cut it.
- ✅ **Keep the format selector.** Format (text overlay / talking head / carousel) is a meaningful creative choice the user *does* care about. Don't hide it.
- ✅ **One simple composer, not the hybrid.** Founder call: don't overcomplicate. Final shape:

  ```
  ┌─────────────────────────────────────────────────────────┐
  │  What do you want to make?                              │
  │  ┌───────────────────────────────────────────────────┐  │
  │  │ Describe the idea, or paste an Instagram URL      │  │
  │  │                                                   │  │
  │  │                                                   │  │
  │  └───────────────────────────────────────────────────┘  │
  │                                                         │
  │  Format:  [ Auto ▾ ]  Text overlay · Talking head ·    │
  │                       Carousel                          │
  │                                                         │
  │                              [   Generate angles   ]    │
  └─────────────────────────────────────────────────────────┘
  ```

  Behavior:
  - Auto-detect Instagram URL paste → route to URL-recreate flow (kicks off `url_adapt`, surfaces the **Blueprint** angle as angle 1).
  - Free text → `idea_match` (existing flow).
  - Empty + click "Generate angles" → `auto_idea` (existing flow).
  - Format default = **Auto** (let the system pick / recommend); user can override.

  Why this over the hybrid:
  - Two surfaces (text + URL paste) cover ~95% of real intent.
  - URL is itself a strong format signal — if the user pastes a talking-head URL, the system already knows. Format select is the override, not the primary input.
  - No mode tabs, no "or start from playbook" disclosure → less to learn, less to skip past.
  - `format_pick` (the niche playbook digests carousel) is **not lost** — it can become a secondary "Browse styles from your niche →" link or live on the dashboard as a separate widget. Don't crowd the composer.

- ✅ **Verify the Blueprint angle survives the cleanup.** When the user pastes a competitor URL and lands on step 2 ("Pick an angle"), angle 1 must keep its green **Blueprint** badge plus the existing one-line note: *"The first angle is the direct blueprint — same structure and topic arc as your source, rewritten in your client's voice."* This is already in the code (see `generate/page.tsx` lines 1460-1485 and `content_generation.py` lines 374-392) and is **the single most important UX signal** that the recreate flow is doing what the user asked. Do not remove it.

### Other Generate-page cleanups

- **The 853-line "Format intelligence from mature competitor reels → five angles → hooks, script, caption, and story lines in your client's voice (client DNA). Digests use reels posted 7+ days ago for reliable performance signals" intro paragraph belongs in a tooltip for engineers, not the page.** Delete or replace with one sentence: *"Pick or describe a reel idea — we'll write 5 angles in your client's voice."*
- **Move "Synthesized patterns" out from behind a chevron.** This is the single biggest differentiator the app has. Render it as an inline "Why we picked these angles" card on step 2. Today the user never clicks the disclosure because the words mean nothing to them.
- **Sessions list at the bottom is admin telemetry.** Status pills like `angles_ready`, `content_ready`, `approved`, `rejected`, source labels like `idea` / `patterns` / `outlier` / `manual` / `adapt url`, the violet "Format —" pill — these are debug values. A creator only needs: *"Reels you've started"* with thumbnail + first hook line + "Continue" or "Delete". Push the rest behind a debug toggle.
- **Kill model/provider names everywhere.** "Created image with gpt-5 via openrouter" type strings get deleted. Replace with neutral state ("Cover generated") or nothing at all.

---

## 7. Intelligence — already deliberately simplified, here's where to go further

(Per founder note: dashboard + intelligence are kept as separate pages. The simplification below stays inside `/intelligence`.)

### Today's structure on `/intelligence`

1. (Red error block if RLS fails — leaks `organization_members`)
2. Toolbar with 3 icon buttons (Sync / Niche radar / Analyze chain link)
3. **`WhatHappenedSection`** — split into two tabs: **"Act now"** and **"Track performance"**
4. Two teaser cards: `BreakoutsTeaserCard` and `CompetitorsTeaserCard`

Then sub-pages: `/intelligence/competitors`, `/intelligence/breakouts`, `/intelligence/reels`.

### Where it can simplify further

**a) Fix the "Act now / Track performance" tabs — the split is real, the labels are abstract.**

Looking at what each tab actually contains, the distinction is genuine: it's **time-since-posted**, not "act vs observe." Both are observation; both lead to recreation.

| Today's tab | What it actually shows under the hood |
|---|---|
| **Act now** | `trending_now`: competitor reels **posted in the last 48h** with views ≥ 30% of that account's average → "a creator just dropped something hot, react now" |
| **Track performance** | `proven_performers` (≥14 days old, ranked by 14d-after-post growth) + `week_breakouts` (top 3 by 7d growth across views/likes/comments) → "older posts still or finally winning" |

The real problem is that "Act now" and "Track performance" sound like they describe **what the user does**, but they actually describe **the age of the content**. So users can't predict what they'll find in either tab.

**Two paths forward — pick one:**

**Path 1 — keep the tabs, just rename them honestly:**
- Tab 1: **"Hot this week"** (was Act now) — *"Competitor reels posted in the last 48h that are overperforming. React fast."*
- Tab 2: **"Long-term winners"** (was Track performance) — *"Older posts still gaining views. Patterns worth studying."*
- Other label pairs that work: *Just dropped / Standing the test of time*, *Right now / Over time*, *Fresh breakouts / Proven evergreens*.

**Path 2 — drop the tabs, stack the sections:**
- Render both sections one after the other on the page with strong section headers.
- Pro: tabs hide content. Most users land on tab 1 and never know tab 2 exists. Stacked makes both visible at once.
- Con: longer page; if "Long-term winners" is rarely useful day-to-day, stacking it dilutes the focus on "Hot this week."

**Recommendation:** Path 1 (rename, keep tabs) — it's a one-line copy fix that solves the actual problem (label clarity) without restructuring the page. Path 2 is only worth it if user research shows people aren't finding tab 2.

Either way: also rename the inner blocks ("Replicate" stays, "Also trending" → "More from the last 48h", "Proven performers" → "Still gaining months later", "Weekly momentum" → "Top growers this week").

**b) Collapse the toolbar to one button.**
Today the toolbar has Sync + Niche scrape (Radar icon, no label) + Analyze-by-URL (chain link icon, no label). Two of those are unlabeled icons that even an experienced user has to hover to understand.

- Sync stays as the primary button (with the 3-radio modal — see §4).
- Niche scrape becomes a checkbox **inside** the Sync modal: *"Also refresh niche keyword reels"*.
- Analyze-by-URL moves into a **secondary** "+ Analyze a reel" link near the breakout grid (not in the global toolbar) — it's a one-off action, not a routine one.

Result: one labeled "Sync" button in the toolbar. Done.

**c) Merge the two teaser cards.**
`BreakoutsTeaserCard` and `CompetitorsTeaserCard` are sibling cards that just show a count and a link. Replace them with a single inline strip at the bottom of the page:

> 🎯 **5 competitor breakouts** • **23 competitors tracked** • [Find more →]

One row, one place to manage things, less visual weight than two cards.

**d) Standardize the multiplier badge.**
Right now the same multiplier appears as `2.4× avg`, `5× your average`, `0.4× @24h`, "× peak vs their average", and as a Silas score number. Pick **one badge format** and use it everywhere: `3× their usual`. Tooltip on hover for the curious. No other variants on screen.

**e) `/intelligence/reels` filter chips are confusing.**
`All sources / Breakouts only / Competitors / Niche reels` mixes a relevance filter (Breakouts only) with source filters (Competitors / Niche reels). They URL-stack but the chips are styled as if mutually exclusive. Fix by separating into:
- A relevance toggle: `Breakouts only` (off/on)
- A source select: `Where from? · All sources / Competitors / Niche keywords`

**f) Competitors page row is overloaded.**
Every row has ~12 affordances (rank, handle, pill, avg views, multiplier, followers, last-synced, "Their reels", "Profile", "Why we track this", "Sync reels [N▾]", Delete, 3 thumbnails). Strip to **4 things**: avatar + handle, `5× your average`, last-synced ago, and a single **More ▾** menu (sync / delete / profile / why we track this). Add a search box for when the list grows past ~30. Hide the `tier !== 4` "Show all accounts ↓" filter — `tier` is one of the banned words.

---

## 8. Sidebar (kept as-is per founder decision) — minor copy fixes only

We are NOT restructuring the sidebar. But two copy / behavior fixes:

- **Kill or wire up "New project".** Today it toasts *"Projects aren't multi-tenant yet — everything uses your current workspace."* That makes the most prominent button in the chrome a lie. Either remove it or make it work. There's no third option.
- **Remove the `/scheduling` link** from the sidebar until the page actually does something. Today it's a placeholder ("Approval queue and calendar will live here.") — a broken promise on every page render is worse than no link.

---

## 9. What's working well (don't break these)

- The **breakout / outbreaker math** is genuinely good. The data scaffolding (snapshots, growth metrics, post-age normalization) is exactly what creators need — it just doesn't have a face today.
- **`SyncDataModal`** (3-radio + progress bar) is the gold standard for how every sync surface in the app should feel. Promote it everywhere.
- **The "Recreate" → `/generate?session=…` deep-link** is the right flow. Intelligence-to-generation handoff is conceptually correct; it just needs to be **the only flow**, not one of five.
- **Dark mode + glass styling** is consistent and pleasant.
- **Synthesized patterns content** (hook patterns, tension mechanisms, top performer features) is rich and useful — once the user can see it.
- **Per-reel `View analysis` modal** is a legitimately good detail surface.

---

## 10. Things explicitly de-scoped (acknowledged, not actioned now)

- **Sidebar restructure** — keep current 7-item sidebar.
- **Dashboard / Intelligence consolidation** — keep both as separate pages.
- **Session persistence / "Continue where I left off"** — too complex relative to value right now. Revisit later.
- **Onboarding auto-profile-from-Instagram** — already specced in `AUTO-PROFILE-FROM-INSTAGRAM.md`, treated separately from this audit.
- **Notifications when long-running jobs finish** — nice to have, not urgent.

---

## 11. Verified: the Recreate flow already adapts the source reel using Client DNA

Founder concern: *"In the Recreate flow, is the first angle that appears literally adapting that reel with our own client DNA?"*

**Answer: yes, this is already wired correctly. No backend change needed.** Verified across two files:

**Backend (`backend/services/content_generation.py` lines 374-392):** when a generation session has `adapt_single_reference_reel=True` (which is set for `url_adapt` and `script_adapt` modes — see `backend/routers/generation.py` lines 436, 474, and `_session_adapts_single_reference_reel`), the angle-generation prompt is forced into a special branch:

> ANGLE 1 (array index 0) — **FAITHFUL BLUEPRINT / direct adaptation**:
> - This is the "recreate this reel" option: keep the same format class, hook mechanism, beat structure, pacing, topic arc, and payoff as the source…
> - Only swap what must change for the client: language, names, setting, and concrete examples so they fit GENERATION_BRIEF, VOICE_BRIEF, and ICP. The viewer should recognize it as the same recipe as the source.
> - Title should read like a direct adaptation (e.g. start with "Blueprint:" or "Direct adaptation —").
>
> ANGLES 2–5 (indices 1–4) — VARIANTS / same recipe, different execution.

The prompt also runs `run_adaptation_synthesis` (lines 712-756) which builds the patterns JSON specifically from the one source reel, with explicit "what to preserve / what to localize" axes, and packs the client row (Client DNA, ICP, voice) as `CLIENT_CONTEXT`. So the LLM sees both the source reel's structure AND the client's full identity at angle-generation time.

**Frontend (`generate/page.tsx` lines 1460-1485):** when `sessionUsesBlueprintFirstAngle(session)` is true, the page renders this above the angle list:

> *"The first angle is the **direct blueprint** — same structure and topic arc as your source, rewritten in your client's voice. The others are same-format variants you can use if you want a twist."*

And angle index 0 gets a green **Blueprint** pill badge.

### Action items (small)

1. **Surface the Blueprint badge with a "Why this is the recreate" tooltip.** Today the badge is silent. Add a `?` icon next to it that shows: *"This angle keeps the source reel's hook, structure, pacing, and payoff — only the language, examples, and client context are swapped to match [Client name]'s voice."* (Use the actual client name from context.)
2. **Verify after the Generate composer redesign** that pasting an Instagram URL still routes through `url_adapt` mode and still shows the Blueprint badge as angle 1. This is the single most important UX signal in the entire app — it must not regress.
3. **In the angle 1 title shown in the UI**, the prompt asks the model to start with "Blueprint:" or "Direct adaptation —". Verify the model is doing this consistently; if not, normalize on the frontend (always prefix angle 1 title with "Blueprint:" when `angle_role === "blueprint"`).

This is one of the things this product gets RIGHT. Don't break it.

---

## 12. The single test I'd run with a real user tomorrow

Sit a content manager in front of the app cold. Don't tell them anything. Time the answer to:

> **"Show me the best reel posted in your client's niche in the last 48 hours, and start adapting it as a script."**

If they take more than 90 seconds (or click into more than 3 different pages), the IA is wrong. Honest guess based on this audit: today they'd take 4–6 minutes and end up confused between *Heating up*, *Act now*, *Replicate*, and *Generate* — four different screens that all *kind of* answer that question.

That click-through is the North Star. Make this question take one click.

---

## 13. Suggested execution order (locked decisions)

Cheapest → biggest UX delta:

1. **Microcopy purge** — delete every model name / provider name / infra term / table name / env var from user-visible UI. Specifically including the *"Created image with gpt-5 via openrouter"* type strings in the create-video flow. (1 day, zero risk.)
2. **Error message rewrite** — replace the two RLS / API-key red blocks with one neutral sentence + a CTA. (½ day.)
3. **Vocabulary file `lib/copy.ts`** — single source of truth for user-facing strings. Remember: keep "**Client DNA**", kill the rest. (1–2 days.)
4. **Intelligence tab rename** — "Act now" → "Hot this week", "Track performance" → "Long-term winners". Plus inner block renames. (1 hour.)
5. **Dashboard "Heating up" rework — Option B (locked):** re-source to competitor breakouts in the last 24h, with `Recreate` deep-link CTA per row. (½ day.)
6. **Sync collapse** — delete redundant sync buttons, route everything through `SyncDataModal`. Move per-competitor sync into a `…` menu. Niche scrape becomes a checkbox inside the sync modal. (1–2 days.)
7. **Generate page Pass 1 — remove `script_adapt`, kill the intro paragraph, surface "Synthesized patterns" inline, demote the sessions list.** (1 day.)
8. **Intelligence: collapse the toolbar to one labeled `Sync` button, merge the two teaser cards into one strip.** (1 day.)
9. **Generate page Pass 2 — composer redesign (locked):** one input ("Describe the idea, or paste an Instagram URL"), one format select (default Auto), one Generate button. Auto-detect URL paste → `url_adapt`. Free text → `idea_match`. Empty + click → `auto_idea`. Verify the **Blueprint** badge still surfaces on angle 1 for URL-recreate sessions (see §11). (3–5 days; biggest UX win, biggest scope.)
10. **(After §9 ships)** add the small `?` tooltip on the Blueprint badge explaining what's preserved vs swapped from the source reel — see §11 action item 1. (1 hour.)

Steps 1–4 are essentially copy and would already lift the perceived quality of the product noticeably — they should ship in the first week.
