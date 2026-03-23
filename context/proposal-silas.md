# Content Automation System — Project Proposal

**Prepared by:** Zark Growth Limited  
**Date:** March 2026  
**Version:** 2.1  

*(Canonical formatted version: `proposal-silas.html` — open in browser or copy into Google Docs.)*

---

## What We're Building

A content intelligence and production system for Instagram Reels — for info product creators managing multiple clients and niches.

The system does the **80%**: research, pattern analysis, content strategy, hook and script generation, video processing (including **multiple layout formats**), and thumbnail creation. You do the **20%**: review in the dashboard, then upload to Instagram and add trending audio.

Your B-roll workflow stays: upload pre-cut B-roll → system burns text overlays → ready `.mp4`. From any viral outlier (scraped or pasted URL), AI extracts structure and intent — then you choose **how** to execute it with up to **five preset video formats** (layout pipelines, not five separate “AI products”).

One client at launch; multi-client from day one.

---

## Deliverables by Week

### Week 1 — Intelligence + Dashboard

- Dashboard (browser, no install)
- Competitor profile scraper (up to 10 accounts / client), engagement-ranked
- Outlier detection (5–10× account average + ratio)
- **Manual viral URL** — paste a public Reel → scrape, analyze, add to intelligence layer
- Per-post AI analysis (hook type, trigger, caption structure, why it likely worked)
- Niche patterns doc per client, auto-updated
- First client configured (niche, competitors, ICP, products, tone, pain points, stories)

**End of Week 1:** Scrape or paste URL → ranked feed + analysis + updated patterns.

### Week 2 — Content generation

- **Outlier → content:** pick a reference → AI summarizes why it worked → generate hooks/captions/scripts **tied to that outlier** (not only generic niche patterns)
- Hook generator (10–20 options): patterns + client + optional selected outlier
- Caption (mini-story, keyword CTA, max 5 hashtags, client voice)
- Talking head script (60s: hook → situation → 3 insights → conclusion → CTA)
- IG Story text variants
- All reviewable in dashboard before production

**End of Week 2:** Hooks + caption + script + story text from real data, client voice.

### Week 3 — Video formats + burn-in + revision prompts + thumbnails + queue

**Five output format presets** (same B-roll + copy, different **ffmpeg layout templates**):

1. **Full-frame B-roll (9:16)** — standard Reel, overlay on picture  
2. **Static / still-first** — strong for still or minimal-motion source  
3. **Letterbox / cinematic** — black bars top/bottom; text per preset rules  
4. **4:5 center in 9:16** — pillarboxed / feed-style framing  
5. **Hook-first / minimal on-video text** — lighter on-screen; story in caption  

After outlier analysis, system suggests a **recommended format** (overridable). Changing format = re-run same assets through another template — **no re-shoot**.

- B-roll upload (pre-cut) → burn-in text → `.mp4` per format  
- Client-level overlay defaults + per-post overrides  
- **Revision prompt box:** natural language (“shorter hook”, “text higher”, “bolder outline”) → updated overlay + **re-export**. Same *class* of edit as tweaking in IG, but **brand-consistent, versioned, multi-client**. Not meant to beat IG for a one-word tweak on a single post — wins on **volume and repeatability**.  
- Thumbnails: **gpt-image-1.5**, portrait, per Reel  
- Queue: preview, approve/reject, prompt revision, regen thumbnail  
- **Download:** video + caption + hashtags → manual post in IG + trending audio (~2 min)

**End of Week 3:** Outlier → hooks/caption → pick format → B-roll → export → optional prompt iterations → thumbnail → download.

### Week 4 — Learning + multi-client + handover

- Performance inputs (views, likes, comments, saves) per post  
- Auto-learning: winners → weighted future generation  
- Approve/reject signals refine preferences  
- Diagnostic buckets (scale / hook / CTA / retire)  
- Second client live (&lt;10 min setup)  
- Handover + docs  

**End of Week 4:** Two clients, learning loop on, handover done.

---

## Questions — Answered (summary)

| Topic | Answer |
|--------|--------|
| Text / caption changes | YES — dashboard + **revision prompt** → re-export video |
| **Multiple looks from one outlier** | YES — **5 format presets** + recommended default |
| Replace B-roll file | YES — re-process with same overlay |
| Cut scenes / NLE inside clip | **OUT OF SCOPE** — B-roll pre-cut before upload |
| Position / size / timing | YES — params + per-post where needed |
| Fullscreen vs letterbox vs static | YES — via the five presets (Reels target 9:16; 16:9 primary can be added if needed) |
| Client data / offers / feedback | YES — profile always editable |
| Multi-platform research | **FUTURE** — IG first; TikTok/Twitter/Reddit as sources later |
| Performance + learning loop | YES |
| Client DB (ICP, pain, stories, positioning) | YES |
| Covers / thumbnails | YES — gpt-image-1.5 |
| Strong hooks/captions logic | Patterns + profile + optional viral URL |
| Talking head voice | Profile tone/style |
| Carousels | YES — multi-slide, same pipeline family |
| Paste viral Reel URL | YES |
| Onboarding | You, dashboard, &lt;10 min |
| IG Story text | YES |

---

## What the System Does NOT Do

- No **in-timeline** B-roll editing (cuts/transitions) — upload finished clips  
- No **auto-post** to Instagram with **trending audio** via API — manual upload + sound  
- No video **recording** — scripts only for talking head  
- No DMs/comments automation  
- Output = **Instagram-focused** this phase (not TikTok/YouTube as primary)  
- No autonomous publishing without approval  

---

## What We Need to Start

1. First client: offer/product, language (DE/EN), target posts/week  
2. API accounts: **Apify**, **Anthropic**, **OpenAI** — credentials before Week 1 E2E tests  

---

## Investment

| Included | Price |
|----------|--------|
| Full system: intelligence + outlier-driven generation + **5 format presets** + B-roll burn-in + **revision prompt box** + thumbnails + learning loop + multi-client dashboard + performance tracking | **€7,000** |

**Payment:** 50% start / 50% delivery (E2E first client + learning loop + second client live at handover).

---

## Running costs (your accounts)

| Service | ~ / month | Notes |
|---------|-----------|--------|
| OpenAI (thumbs) | €3–8 | ~€0.25–0.50/thumb at 5 posts/wk |
| Anthropic | €5–10 | analysis + generation |
| Apify | Zark covers **2 months**, then yours | ~€5–10/mo at this volume |

**~€10–20/month per client** at moderate volume.

---

## Timeline (30 days)

| Week | Focus | Demo |
|------|--------|------|
| 1 | Dashboard, scrape, URL paste, analysis | Viral feed + patterns |
| 2 | Hooks, captions, scripts, story | Full copy package |
| 3 | **Formats + burn-in + prompts + thumb + download** | Full export path |
| 4 | Learning, client 2, handover | Two clients live |

Weekly Friday demos.

---

## Ownership

Code, data, configs — yours on delivery. Further phases (multi-platform sources, deeper automation) = separate scope.

---

*Zark Growth Limited — March 2026*
