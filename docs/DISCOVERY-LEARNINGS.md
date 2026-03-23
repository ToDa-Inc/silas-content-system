# Competitor Discovery — Learnings & Eval Playbook

**Client:** Conny Gfrerer (@connygfrerer)
**Date:** 2026-03-23
**Status:** Phase 1 complete — baseline established

---

## Key Finding: Conny Owns the German Niche

After running 10+ German keyword searches and evaluating 15+ competitors, the data is clear:

| Language | Accounts Found | Best Avg Views | Conny's Median |
|----------|---------------|----------------|----------------|
| English  | 4 strong      | 369K (@thebigapplered) | 9.2K |
| German   | 6 found       | 1.1K (@feinherb.rocks) | 9.2K |
| Polish   | 2 found       | 5.3K (@annaschulzofficial) | 9.2K |

**Conny's avg views (138K) are 125x higher than the best German competitor we found.**
The German-language "workplace communication / toxic boss" niche on Instagram is essentially uncontested.

---

## What Worked (Replicate This)

### 1. Seed Competitor Method (Best ROI)
Starting with 4 known competitors from Silas's original niche strategy file (`context_niche_example`) and validating them via the system. All 4 scored 95/100 relevance and had strong performance. This confirms the niche profile is well-calibrated.

### 2. Broad English Keywords
"leadership coach" returned 10 accounts to evaluate — best keyword by volume. Broad terms work because Instagram's search API is shallow and returns accounts where the keyword appears in bio or name.

### 3. German Compound Keywords
"Führungskräfte Coach" returned 4 accounts (2 matches). German compound words that appear in coach bios work. Single-word German searches ("Selbstführung", "Rhetorik") returned fewer.

### 4. Eval System Catching Bad Matches
The eval system correctly filtered out accounts with high relevance but zero performance (e.g., @leadership_programm: 92/100 relevance, 3 avg views → SKIP). Without performance scoring, these would pollute the competitor list.

---

## What Didn't Work (Avoid This)

### 1. Narrow German Keywords
"toxischer Chef", "Persönlichkeitsentwicklung Arbeit" — returned almost nothing. Too specific for Instagram's search.

### 2. Hashtag-based Discovery
Instagram's API doesn't support hashtag → user discovery well. Keywords search user bios, not content.

### 3. Expecting German Scale
The German Instagram coaching market is simply smaller. Accounts exist but with <1K views. For viral pattern extraction, English accounts are the blueprints.

---

## German Keywords Tried (Full Log)

| Keyword | Accounts Found | Competitors | Best Find |
|---------|---------------|-------------|-----------|
| Führungskräfte Coach | 4 | 2 | @feinherb.rocks (1.1K views) |
| Kommunikationstrainerin | 2 | 0 | — |
| Business Coach deutsch | ? | ? | — |
| Karriere Coach | 1 | 0 | — |
| Persönlichkeitsentwicklung Arbeit | ? | ? | — |
| Rhetorik Coach | 2 | 1 | @runge_trainer_coach_speaker (739 views) |
| Führung Kommunikation | 1 | 1 | @mit.menschen.in.fuehrung (341 views) |
| toxischer Chef | ? | ? | — |
| Leadership Coach deutsch | ? | ? | — |
| Selbstführung | 4 | 1 | @anja_hampel_coaching (57 views) |

---

## Conny's Baseline Metrics

Scraped: 2026-03-23 (30 most recent reels)

| Metric | Value |
|--------|-------|
| Avg views | 138,966 |
| Median views | 9,254 |
| P90 views | 738,235 |
| Max views | 1,556,354 |
| Avg likes | 1,971 |

### Performance Thresholds (derived from baseline)

| Threshold | Views | Meaning |
|-----------|-------|---------|
| Blueprint | 738K+ | Consistently outperforms Conny's top 10% |
| Useful | 9.2K+ | Matches Conny's typical performance |
| Peer | 4.3K+ | Active but smaller |

---

## Final Competitor Ranking (after all searches)

### Tier 2 — STRONG (Study these)

| Account | Avg Views | Language | Key Topics |
|---------|-----------|----------|------------|
| @thebigapplered | 369,543 | EN | Toxic boss, leadership language, workplace boundaries |
| @heyworkfriend | 199,130 | EN | Workplace boundaries, salary negotiation, power dynamics |
| @corporateclarity.career | 70,894 | EN | Workplace manipulation, setting boundaries, high performer psychology |
| @eloisegagnon_strategist | 10,992 | EN | Executive presence, workplace authority, influence |

### Tier 3 — PEER (Watch for breakouts)

| Account | Avg Views | Language | Key Topics |
|---------|-----------|----------|------------|
| @feinherb.rocks | 1,119 | DE | Leadership communication, employee accountability |
| @annaschulzofficial | 5,325 | PL | Leadership decision-making, team management |

### All German accounts found (for market awareness)

| Account | Avg Views | Followers | Topics |
|---------|-----------|-----------|--------|
| @feinherb.rocks | 1,119 | 3,617 | Leadership communication |
| @runge_trainer_coach_speaker | 739 | 988 | Rhetoric, conflict management |
| @mit.menschen.in.fuehrung | 341 | 1,642 | Leadership, team dynamics |
| @heikebrittaunap | 71 | 4,760 | Self-leadership, stress |
| @anja_hampel_coaching | 57 | 2,123 | Inner leadership, authentic communication |
| @leadership_programm | 3 | 3,821 | Leadership communication |

---

## Strategic Implications

1. **For outlier analysis:** Study @thebigapplered and @heyworkfriend — they're the closest to Conny's content with 2-40x her median views
2. **For German market:** Conny has no real competition. She IS the benchmark. Any new German account entering this niche will be competing against her
3. **For content strategy:** English-language viral patterns (hooks, formats, psychology) can be adapted to German. The content principles are universal
4. **For Silas's DFY pitch:** "You're the #1 German-language account in this niche" is a powerful data point to show Conny

---

## Next Steps for Discovery Improvement

1. **"Suggested accounts" scraping** — When Instagram shows "Similar accounts" on a profile, those are algorithmically related. Scraping these from the 4 strong English competitors could surface German accounts that IG's algorithm groups together
2. **TikTok cross-reference** — German coaches may be more active on TikTok. Worth checking
3. **YouTube Shorts** — Same content, different platform. German coaches may post there
4. **Recurring eval** — Re-run eval monthly. Small accounts can break out. @feinherb.rocks at 1.1K views today could be at 50K next month
