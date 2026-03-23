# Content Automation System - COMPLETE PROJECT PLAN

**Last Updated:** 2026-03-05  
**Status:** Planning Phase  
**Target User:** Friend (marketing for Improv/info product producers in Germany)

---

# PART 1: VISION & OVERVIEW

## 1.1 What We're Building

An automated content creation system for Instagram Reels (expandable to TikTok/YouTube):

1. **Scraping** — Find top-performing content in specific niches
2. **Analyzing** — Understand why posts win (hooks, formats, psychology)
3. **Generating** — Create new hooks/scripts based on winning patterns + ICP
4. **Creating** — Generate B-roll + captions (using gpt-image-1.5)
5. **Posting** — Schedule via Postiz API
6. **Dashboard** — Manage, track, optimize

**End Goal:** Volume content creation without manual effort. A machine that learns and improves.

---

# PART 2: TARGET AUDIENCE

## 2.1 First User: Friend (Germany)

- Manages marketing for Improv/info product producers
- Runs their Instagram Reels
- Builds inbound funnels and flows
- Sells info products in niches: burnout, work stress, productivity, etc.

## 2.2 Pain Point

Creating enough content at volume. Already knows what works — just needs to produce more.

## 2.3 Content Format

- **Platform:** Instagram Reels (later: TikTok, YouTube Shorts)
- **Style:** B-roll + captions + music
- **Complexity:** Simple, template-based

---

# PART 3: THE PIPELINE

```
┌─────────────────────────────────────────────────────────────────────┐
│                        CONTENT MACHINE                              │
├─────────────────────────────────────────────────────────────────────┤
│   PHASE 1        PHASE 2        PHASE 3        PHASE 4        PHASE 5│
│   ┌──────┐       ┌──────┐       ┌──────┐       ┌──────┐       ┌──────┐│
│   │SCRAPE│   →   │ANALYZE│   →   │GENER │   →   │CREATE│   →   │POST  ││
│   │Outliers      │Hook   │       │Script │       │Video │       │Schedule│
│   │from niche    │Psych  │       │Hooks  │       │Captions      │API    │
│   │              │Format │       │       │       │Music         │       │
│   └──────┘       └──────┘       └──────┘       └──────┘       └──────┘│
│                                              ┌──────────────────────┐│
│                                              │   DASHBOARD          ││
│                                              │   (manages all)      ││
│                                              └──────────────────────┘│
└─────────────────────────────────────────────────────────────────────┘
```

---

# PART 4: PHASE BREAKDOWN

## Phase 1: Scraping (PRIORITY)

**Goal:** Get top-performing posts from a niche

**Approach:**
1. Use Apify API to scrape posts by hashtag/keyword
2. Filter by: recent (7 days), high engagement
3. Extract: URL, hook, caption, hashtags, views, likes
4. Store in JSON for analysis

**Input:** Niche name (e.g., "burnout", "productivity")
**Output:** `data/niches/{niche}-outliers.json`

---

## Phase 2: Analyzing

**Goal:** Understand why outlier posts work

**Approach:**
1. Take scraped posts
2. Analyze each: hook type, format, caption structure, hashtags
3. Identify winning patterns
4. Generate patterns doc per niche

**Input:** Outliers from Phase 1
**Output:** `data/patterns/{niche}-patterns.json`

---

## Phase 3: Generating

**Goal:** Create new hooks/scripts from patterns + ICP

**Approach:**
1. Input: ICP + Product info + Winning patterns
2. Generate: 10-20 hook options
3. Select: Best hook → full script
4. Output: Ready-to-use hook + caption

**Input:** ICP + Product + Patterns
**Output:** `data/posts/{date}/{post-id}/script.json`

---

## Phase 4: Creating

**Goal:** Turn script into video/B-roll

**Approach:**
1. Get script from Phase 3
2. Generate B-roll: gpt-image-1.5 (image slides with text)
3. Add text overlays (Larry's rules)
4. Output: Image sequence ready for posting
5. Music: Manual step before posting

**Notes:**
- Using gpt-image-1.5 for image slides (simpler than video generation)
- Text overlay rules from Larry (30% from top, 6.5% font)
- Music: User adds trending sound (10x reach boost)

---

## Phase 5: Posting

**Goal:** Schedule and publish via API

**Approach:**
1. Upload to Postiz
2. Add caption, hashtags
3. Schedule or post immediately
4. Track: post ID, time, status

**Tools:** Postiz API

---

## Phase 6: Dashboard (Future)

**Goal:** UI to manage everything

**Features:**
- Client management
- Niche configs
- Post queue (approve/reject/schedule)
- Analytics (views, engagement, conversions)
- Performance tracking (auto-learn what works)

---

# PART 5: TECHNICAL STACK

## 5.1 Stack

| Component | Tool | Notes |
|-----------|------|-------|
| **AI (text)** | Claude Sonnet 4.6 | Analysis, generation |
| **AI (B-roll)** | gpt-image-1.5 | Image slides with captions |
| **Scraping** | Apify API | Instagram hashtag search |
| **Posting** | Postiz API | Instagram scheduling |
| **Storage** | Local files + JSON | MVP, can migrate later |
| **Deployment** | Claude Code / OpenClaw | Self-hosted on VPS |

## 5.2 Directory Structure

```
tiktok-marketing/
├── config/
│   └── clients/
│       └── {client_id}/
│           ├── config.json
│           ├── icp.json
│           └── products.json
├── scraping/
│   └── scraper.js
├── analysis/
│   └── analyzer.js
├── generation/
│   └── generator.js
├── creation/
│   └── video-creator.js
├── posting/
│   └── poster.js
├── dashboard/
│   └── (future)
├── data/
│   ├── niches/
│   ├── patterns/
│   └── posts/
└── scripts/
    └── utilities/
```

---

# PART 6: LARRY SKILL KNOWLEDGE (CRITICAL)

This section contains the battle-tested knowledge from the Larry skill that applies to our system.

## 6.1 Hook Formulas (PROVEN)

### Tier 1: Person + Conflict → AI → Changed Mind (BEST)
- "I showed my landlord what AI thinks our kitchen should look like" (161K views)
- "My boyfriend said our flat looks like a catalogue so I showed him"
- "My mum said I'd never amount to anything so I showed her this"

### Tier 2: Relatable Budget Pain
- "POV: You have good taste but no budget"
- "IKEA budget, designer taste"
- "I can't afford an interior designer so I tried AI"

### Tier 3: Curiosity / Self-Discovery
- "I've always wondered what I'd look like with..."
- "I had to see if it would even suit me"
- "Everyone's getting [thing] but would it suit MY face?"

### What DOESN'T Work
- Self-focused complaints without conflict: "My flat is ugly" (low views)
- Fear/insecurity hooks for beauty: "Am I ugly without..." (people scroll past)
- Price comparison without story: "$500 vs $5000" (needs character)

---

## 6.2 Hook Adaptation by Category

### For Info Products (Our Use Case)
Replace [topic] with your niche:
- "My coach told me I'd never [goal] so I showed him this"
- "I've been struggling with [pain point] for years until..."
- "POV: You're about to [bad outcome] but don't know it yet"
- "The moment you realize [truth about niche]"

### Examples for Burnout/Work Niche:
- "My boss told me I was working too much so I showed him this"
- "POV: You're 3 coffees into the day and already exhausted"
- "I was heading for burnout until I learned this one thing"
- "The moment I realized my job was killing me"

---

## 6.3 Text Overlay Rules (CRITICAL)

These rules come from thousands of iterations. Follow exactly:

### Position
- **30% from top** (NOT center)
- Top 10% hidden by Instagram UI
- Bottom 20% hidden by caption/buttons

### Font Size
- **6.5% of image width**
- ~66px on 1024px image
- Too small = unreadable on phones

### Outline
- **15% of font size**
- Thick black outline
- Makes text readable on ANY background

### Lines
- **4-6 words max per line**
- Use manual `\n` breaks
- Short lines = scannable at a glance
- 3-4 lines per slide is ideal

### Content Style
- **REACTIONS, not labels**
- ✅ "Wait... this is actually nice??"
- ❌ "Modern minimalist style"

### Example (Good)
```
I showed my landlord
what AI thinks our
kitchen should look like
```

---

## 6.4 The 6-Slide Structure (Adaptable)

| Slide | Purpose | Text Style |
|-------|---------|------------|
| 1 | HOOK | Relatable problem, full hook |
| 2 | PROBLEM | Amplify pain, build tension |
| 3 | DISCOVERY | "So I tried this" / "Then I found..." |
| 4 | TRANSFORMATION 1 | Reaction: "Wait... this actually looks good?" |
| 5 | TRANSFORMATION 2 | Reaction: "Okay I'm obsessed" |
| 6 | CTA | App/product name + "link in bio" |

**For B-roll + captions:** Use 1-2 key text overlays, not all 6 slides.

---

## 6.5 Image Generation Rules (Larry's Secret)

### Model: gpt-image-1.5 (NEVER gpt-image-1)
- The quality difference is MASSIVE
- gpt-image-1 produces obviously AI images
- gpt-image-1.5 produces photorealistic results

### Prompt Format (Exact Template)
```
iPhone photo of a [CONTEXT]. [DETAILED DESCRIPTION].
Shot from [CAMERA POSITION]. [SPECIFIC DETAILS].
Natural lighting, realistic colors, phone camera quality.
Portrait orientation (1024x1536).
No text, no watermarks, no logos.
```

### What to Lock (Same Across All Slides)
- Subject dimensions/features
- Camera angle/position
- Lighting direction
- Background elements
- Physical structure

### What Changes Per Slide (ONLY)
- Style/aesthetic
- Colors/textures
- Decor/accessories

### Cost
- Real-time: ~$0.50/slideshow
- Batch API: ~$0.25/slideshow

---

## 6.6 Posting Workflow (MANDATORY)

### Draft Posting
- **Posts go to Instagram as DRAFTS** (SELF_ONLY privacy)
- User adds trending sound manually
- This is NON-NEGOTIABLE

### Why Music Matters
- Trending audio boosts reach 10x+
- Posts without music get buried
- Algorithm actively favours popular sounds

### The Manual Step (30 sec/post)
1. Open Instagram drafts
2. Tap "Add sound"
3. Browse trending sounds in your niche
4. Pick popular one
5. Publish

**This is the one step that can't be automated and makes a massive difference.**

---

## 6.7 Analytics Loop (The Intelligence)

### What Gets Tracked
- Views, likes, comments, shares
- (With RevenueCat) Trials, conversions, MRR

### The Diagnostic Framework

| Views | Conversions | Action |
|-------|-------------|--------|
| High | High | 🟢 **SCALE** — make 3 variations |
| High | Low | 🟡 **FIX CTA** — hook works, downstream broken |
| Low | High | 🟡 **FIX HOOKS** — CTA works, need eyeballs |
| Low | Low | 🔴 **FULL RESET** |

### Decision Rules
- **50K+ views** → DOUBLE DOWN, make 3 variations immediately
- **10K-50K** → Good, keep in rotation
- **1K-10K** → Try 1 more variation
- **<1K (twice)** → DROP, try radically different

---

## 6.8 Caption Template (From Larry)

```
[hook matching visual] 😭 [2-3 sentences of relatable struggle].
So I found this [product] that [what it does] -
you just [simple action] and it [result]. I tried [example]
and honestly?? [emotional reaction]. [funny/relatable closer] 
#[niche1] #[niche2] #[niche3] #[niche4] #fyp
```

**Rules:**
- Conversational, tell a mini-story
- Mention product naturally, NOT salesy
- Max 5 hashtags

---

# PART 7: HOW LARRY APPLIES TO OUR SYSTEM

## 7.1 What's Applicable

| Larry Component | Our Adaptation |
|-----------------|----------------|
| **Hook formulas** | Phase 2 (analysis) + Phase 3 (generation) |
| **Text overlay rules** | Phase 4 (captions on B-roll) |
| **Postiz integration** | Phase 5 (posting to Instagram) |
| **Daily report** | Dashboard (performance tracking) |
| **Diagnostic framework** | Dashboard (views vs conversions) |

## 7.2 Key Differences from Larry

| Larry | Our System |
|-------|------------|
| TikTok | Instagram Reels |
| AI-generated images (6 slides) | B-roll + captions (gpt-image-1.5) |
| 6-slide slideshows | Single video with text overlay |
| App marketing | Info products (different content) |
| Single app | Multi-client (friend + his clients) |

## 7.3 What We Keep from Larry

1. ✅ Hook formulas (Tier 1-3)
2. ✅ Text overlay rules (30% from top, 6.5% font, thick outline)
3. ✅ Draft posting workflow
4. ✅ Diagnostic framework
5. ✅ Postiz integration

---

# PART 8: RESEARCH FINDINGS

## 8.1 Scraping Options (Deep Research via Perplexity)

**Winner: Apify** — 95%+ success, hashtag search works, cheapest

| Tool | Instagram Hashtags | Cost (10K posts) | Verdict |
|------|-------------------|------------------|---------|
| **Apify** | ✅ Works | $4-8 | ✅ Best |
| Bright Data | ✅ Works | $20-50 | Enterprise |
| Oxylabs | ✅ Works | $15-30 | Good |
| ScrapingBee | ✅ Works | $10-20 | Budget |

**Why Apify:**
- Pre-built Instagram scraper actors
- Handles blocks automatically
- 95%+ success rate
- $5 free credits to start
- Easy API integration

---

# PART 9: WHAT'S NEEDED TO START

## 9.1 Prerequisites

1. **OpenAI API key** — gpt-image-1.5 (~$0.25-0.50/post)
2. **Anthropic API key** — Claude Sonnet 4.6
3. **Apify account** — apify.com ($5 free credits)
4. **Postiz account** — postiz.pro/oliverhenry
5. **Instagram account** — Connected to Postiz (warmed up 7-14 days)

## 9.2 Per Client Config

- Client name
- Niches to target (e.g., burnout, work stress)
- ICP (who are they targeting?)
- Product info (what are they selling?)
- Instagram account to post to

---

# PART 10: MVP DEFINITION

## Simplest Working Version

1. **Manual scraping** — Apify API, you approve
2. **Manual analysis** — Claude analyzes, you review
3. **Manual generation** — Generate hooks, pick best
4. **Manual creation** — gpt-image-1.5 generates slides
5. **Manual posting** — Postiz, add music manually

**Goal:** Prove the flow works, then automate each piece.

---

# PART 11: OPEN QUESTIONS

These don't block building but should be answered eventually:

1. **First niches:** What exactly? (burnout, work stress, productivity?)
2. **Product:** What's the info product? (course, coaching, PDF?)
3. **ICP:** Who exactly are they targeting? (age, job, pain points)
4. **Success criteria:** How do we know it's working?
5. **Timeline:** Any deadline?
6. **Budget:** What's the monthly API spend limit?

---

# PART 12: NEXT STEPS

1. ✅ Plan created (this file)
2. ⏳ Start Phase 1 — Build Apify scraper
3. ⏳ Configure first client details
4. ⏳ Test the full flow

---

# APPENDIX: KEY FILES REFERENCE

## From Larry Skill

| File | Purpose |
|------|---------|
| `skills/Larry/SKILL.md` | Full orchestration + 800+ lines |
| `references/slide-structure.md` | 6-slide formula + hook templates |
| `references/competitor-research.md` | How to research niche |
| `references/analytics-loop.md` | Postiz + RevenueCat integration |
| `scripts/generate-slides.js` | AI image generation |
| `scripts/add-text-overlay.js` | Text positioning |
| `scripts/post-to-tiktok.js` | Postiz API posting |
| `scripts/daily-report.js` | Analytics + diagnostics |

## Our Project Files

| File | Purpose |
|------|---------|
| `tiktok-marketing/PROJECT_PLAN.md` | This file |
| `tiktok-marketing/LARRY_STUDY.md` | Initial Larry analysis |
| `tiktok-marketing/config.json` | Config template |
| `tiktok-marketing/competitor-research.json` | Research output |
| `tiktok-marketing/strategy.json` | Content strategy |
| `tiktok-marketing/hook-performance.json` | Hook tracking |

---

*Let's build.*