Content Automation System — MASTER PROJECT DOCUMENT
Last Updated: 2026-03-05
Status: Planning Phase → Phase 1 Active
Operator: Silas (runs manually)
First Client: Conny Gfrerer (@connygfrerer)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PART 1: VISION & OVERVIEW
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1.1 What We're Building
An automated content creation system for Instagram Reels.
Personal tool first → SaaS product later (other creators/agencies).

The pipeline:
  Scraping    → Find top-performing content in specific niches
  Analyzing   → Understand why posts win (hooks, formats, psychology)
  Generating  → Create hooks + scripts based on winning patterns + ICP
  Creating    → Generate atmospheric B-roll + text overlay captions
  Posting     → Schedule as draft via Postiz API (music added manually)
  Dashboard   → Web app to manage clients, queue, analytics

End Goal: Volume content production without manual effort per post.
A system that learns from what performs and scales output accordingly.

1.2 Context — Why This Exists
Silas manages Instagram content for info product creators in Germany.
He builds their inbound funnels, Reels, and content strategy.
He already knows what works — hooks, formats, psychology.
The bottleneck is volume: producing enough content consistently.
This system removes that bottleneck by automating the repeatable parts.

1.3 Scope Boundaries (What This Is NOT)
- Not a video editor (we generate static image slides, not real video)
- Not a talking head recorder (scripts generated, Conny films herself)
- Not fully autonomous (Silas reviews and approves each step)
- Not a managed service (Silas operates it himself)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PART 2: PEOPLE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

2.1 Operator: Silas
Role: Marketing manager for info product creators in Germany
Responsibilities: Reels production, inbound funnels, content strategy
Technical level: Non-developer — uses dashboard UI, not CLI scripts
Workflow: Manual, review-at-each-step. Silas approves before anything posts.

2.2 First Client: Conny Gfrerer
Instagram: https://www.instagram.com/connygfrerer/
Niche: Communication × Leadership × Workplace Psychology
Products: Info products (course/coaching) — details TBD with Silas
ICP: Professionals dealing with difficult workplace dynamics
  → Toxic bosses, passive-aggressive colleagues, boundary issues
  → People who feel overlooked, manipulated, or stuck at work
  → Likely: 28–45, employed, career-driven, emotionally intelligent

2.3 Multi-Client Architecture (From Day 1)
Conny is Client #1. The system is built scalable from the start.
Each client has isolated config: niche, ICP, product info, Instagram account.
Dashboard supports multiple clients — just one active initially.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PART 3: CONTENT STRATEGY (Conny's Niche)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

3.1 Three Core Niches (Conny)

Niche 1: Workplace Communication
  Topic: How professionals handle difficult conversations at work
  Why it works: Highly relatable, clear before/after transformation
  Keywords: workplace communication, difficult conversations, toxic workplace,
            boundaries at work, office politics, difficult boss, manipulation
  Content angles:
    - What to say when your boss pressures you
    - How to respond to passive-aggressive colleagues
    - How to set boundaries at work without burning bridges
    - Professional responses to disrespect
    - Leadership communication mistakes

Niche 2: Workplace Psychology
  Topic: Hidden dynamics and power structures in organizations
  Why it works: Makes people feel "in on something", generates debate
  Keywords: workplace psychology, toxic leadership, narcissistic boss,
            power dynamics, psychological safety, red flags
  Content angles:
    - Red flags smart employees notice early
    - Signs your boss is insecure
    - Why competent employees stay quiet
    - How manipulation works at work
    - Why high performers leave companies

Niche 3: Personal Authority & Boundaries
  Topic: Inner confidence + external communication skills
  Why it works: Aligns with Conny's core product (inner stability × communication)
  Keywords: boundaries at work, self leadership, personal authority,
            confidence at work, assertive communication, self respect
  Content angles:
    - Stop being "too nice" at work
    - Why confident people speak less but clearer
    - The difference between nice and kind
    - What strong communicators do differently

3.2 Two Content Formats

FORMAT A — 7-Second Static Slide Reel (AUTOMATABLE)
  Purpose: Stop the scroll, trigger curiosity, deliver value in caption
  Structure:
    1. Ultra-clear catchy hook (0–2 sec): direct, specific, slightly provocative
    2. Matching atmospheric background image (generated via gpt-image-1.5)
    3. Text overlay on image (Larry's rules: position, font, outline)
    4. Curiosity trigger: hints at insight without explaining everything
    5. Caption delivers the real value: insight, framework, scripts
    6. CTA at end of caption: "Comment 'Clarity' if you want this"
  This format is FULLY AUTOMATED by our system.
  Music is added manually by Silas before publishing.

FORMAT B — 60-Second Talking Head Reel (SCRIPT ONLY)
  Purpose: Build authority, go deeper on psychological insights
  Structure:
    1. Strong hook (0–3 sec): identify the exact situation/problem
    2. Context (3–10 sec): relatable workplace scenario
    3. Insight / Lesson (10–45 sec): 3 clear points, frameworks, psychology
    4. Simple conclusion (45–55 sec): memorable one-liner
    5. CTA (final seconds): follow, comment keyword, or join training
  Our system generates the SCRIPT. Conny films herself.
  System does NOT produce the video file for this format.

3.3 What Makes a Post Viral (This Niche)

Characteristics of outlier posts:
  1. Instant hook (0–2 sec) — viewer knows exactly what it's about immediately
  2. High relatability — "that happened to me"
  3. Cognitive tension — curiosity or mild disagreement ("Stop being nice at work")
  4. Clear value — insight, language, script, framework, validation
  5. Comment trigger — controversy, recognition, hidden frustration validated

Content types that consistently go viral:
  - "Red Flags" (manipulation signs, leadership red flags)
  - "What To Say Instead" (professional responses, boundary sentences)
  - Hidden Psychology (why competent people stay quiet, why bosses fear strong employees)
  - Corporate Reality (why promotions are political)
  - Situational Reels ("It's 16:52 and your boss asks for something urgent")

What BREAKS a reel in this niche:
  - Weak hook: "Today I want to talk about communication" — too slow
  - Too abstract: "Communication is important" — no concrete situation
  - No emotional trigger — no comments, no shares
  - Too much explanation — insights not lectures
  - No relatability — use specific scenarios not generic statements

3.4 Viral Benchmarks (This Niche)

Views:
  Small account → Viral = 100k–500k views
  Medium account → Viral = 500k–2M views
  Large account → Viral = 1M–10M views

Outlier definition: 10x–100x the account's average views

Engagement benchmarks:
  Like rate: 5–10% (100k views → 5k–10k likes)
  Comment rate: 0.3–1% (high = controversial or relatable)
  Save rate: 1–3% (frameworks, scripts, checklists save well)
  Share rate: 1–5% (shares = validation of frustration or exposing manipulation)

3.5 Competitor Accounts (Scraping Seeds)
These are reference creators performing well in Conny's niche:
  https://www.instagram.com/eloisegagnon_strategist
  https://www.instagram.com/thebigapplered
  https://www.instagram.com/corporateclarity.career
  https://www.instagram.com/heyworkfriend/reels/

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PART 4: THE PIPELINE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐
│  PHASE 1 │ → │  PHASE 2 │ → │  PHASE 3 │ → │  PHASE 4 │ → │  PHASE 5 │
│  SCRAPE  │   │ ANALYZE  │   │ GENERATE │   │  CREATE  │   │   POST   │
│          │   │          │   │          │   │          │   │          │
│ Hashtag  │   │ Why did  │   │ Hooks    │   │ B-roll   │   │ Postiz   │
│ + Profile│   │ it work? │   │ Scripts  │   │ Captions │   │ Draft    │
│ scraping │   │ Patterns │   │ Captions │   │ (images) │   │ + Music  │
└──────────┘   └──────────┘   └──────────┘   └──────────┘   └──────────┘
                                                    ↑
                                           ┌────────────────┐
                                           │   DASHBOARD    │
                                           │ (web app, all  │
                                           │  phases live   │
                                           │   here)        │
                                           └────────────────┘

Build Order:
  Phase 1A: Dashboard scaffold (web app structure, client config)
  Phase 1B: Scraping (Apify integration, results shown in dashboard)
  Phase 2: Analysis (Claude analyzes outliers, patterns stored per niche)
  Phase 3: Generation (hooks + scripts from patterns + ICP)
  Phase 4: Creation (gpt-image-1.5 backgrounds + text overlay)
  Phase 5: Posting (Postiz API, draft → manual music → publish)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PART 5: PHASE BREAKDOWN
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

PHASE 1A — Dashboard Scaffold (FIRST BUILD)
Goal: Web app that hosts the whole pipeline. Must exist before anything else.
Stack: Next.js (full-stack) → deployed on Vercel
MVP features:
  - Client list (Conny as client #1)
  - Per-client config: niche, ICP, product, Instagram handle
  - Navigation shell for all pipeline phases
  - Scraping results view (ready for Phase 1B output)
  - Post queue (approve/reject/schedule)
Data: JSON files locally → migrate to DB later
Auth: Simple env-key protection for now (Silas is sole operator)

PHASE 1B — Scraping
Goal: Find top-performing posts in Conny's niches automatically
Approach: Dual scraping strategy
  A) Hashtag scraping: Search by niche keywords, get recent high-engagement posts
  B) Competitor profile scraping: Pull top posts from the 4 reference accounts
Tools: Apify API (Instagram hashtag actor + profile actor)
Filter criteria:
  - Hashtag: Last 7 days, minimum view threshold (configurable per niche)
  - Profile: Top posts ranked by views, mark as outlier if 10x account average
Extract per post:
  - URL, thumbnail, hook text, caption, hashtags
  - Views, likes, comments, saves, shares
  - Account handle, account avg views (for outlier ratio)
  - Post date, format (reel/image)
Output: Stored per client per niche, displayed in dashboard for Silas to review
Input to trigger: Silas clicks "Scrape" in dashboard, selects niche + accounts

PHASE 2 — Analyzing
Goal: Understand why outlier posts win, extract reusable patterns
Approach: Claude Sonnet analyzes each scraped outlier
Analyze per post:
  - Hook type (conflict, POV, curiosity, red flag, situational)
  - Emotional trigger used (fear, validation, anger, recognition)
  - Content angle (red flags, what-to-say, hidden psychology, CTA)
  - Caption structure (story, list, framework)
  - Hashtag pattern
Identify across posts:
  - Most common hook patterns for this niche
  - What emotional triggers appear in high-view posts
  - Content angle distribution
  - Caption length and structure trends
Output: patterns.json per niche per client, rendered in dashboard
Silas reviews patterns before generation step

PHASE 3 — Generating
Goal: Create ready-to-use hooks and scripts from patterns + ICP
Two outputs:

For Format A (7-sec static slide):
  - 10–20 hook options generated from winning patterns
  - Silas selects the best hook
  - System generates: final hook text, 1-2 caption overlays, full caption, hashtags
  - Output: script.json ready for Phase 4

For Format B (60-sec talking head):
  - System generates full script for Conny to record
  - Structure: hook → context → 3 insights → conclusion → CTA
  - Tone: Conny's voice (informed from ICP + product config)
  - Output: script.md that Silas sends to Conny

Input: ICP + product info + niche patterns
Output: data/clients/{client_id}/posts/{date}/{post_id}/script.json

PHASE 4 — Creating (Format A only — 7-sec static slide)
Goal: Turn script into a ready-to-post image with caption
Two-layer process:
  Layer 1: Background image generation (gpt-image-1.5)
    - Style: Atmospheric, atmospheric office/workplace/abstract scene
    - NOT stock photo generic — photorealistic, iPhone-photo quality
    - Portrait orientation: 1024x1536
    - No text, no logos, no watermarks in the generated image
    - Prompt template (adapted from Larry for workplace niche):
        "iPhone photo of a [OFFICE/WORKPLACE SCENARIO]. [ATMOSPHERIC DETAILS].
         Shot from [CAMERA POSITION]. [SPECIFIC MOOD/LIGHTING DETAILS].
         Natural lighting, cinematic quality, phone camera feel.
         Portrait orientation (1024x1536). No text, no watermarks."

  Layer 2: Text overlay (programmatic, NOT AI)
    - Applied in code after image generation
    - Larry's rules applied exactly:
        Position: 30% from top
        Font size: 6.5% of image width (~66px on 1024px)
        Outline: 15% of font size, thick black
        Lines: 4–6 words max, manual line breaks
        3–4 lines per slide
        Style: REACTIONS not labels
    - Output: Final composite image ready for posting

Cost: ~$0.25–0.50 per image (gpt-image-1.5 batch pricing)

PHASE 5 — Posting
Goal: Schedule post to Instagram via Postiz, add music manually
Workflow:
  1. Silas reviews final image + caption in dashboard
  2. Approves → system pushes to Postiz as DRAFT (SELF_ONLY privacy)
  3. Silas opens Instagram, goes to drafts
  4. Adds trending sound (30 sec manual step — NON-NEGOTIABLE)
  5. Publishes
Track: post_id, posted_at, status, Postiz job ID
IMPORTANT: Music step cannot be skipped — trending audio = 10x reach

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PART 6: TECHNICAL STACK
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

6.1 Stack

Component         Tool                    Notes
─────────────     ──────────────────────  ─────────────────────────────────
Frontend/App      Next.js (App Router)    Full-stack, API routes included
Deployment        Vercel                  Silas accesses via browser URL
AI (text)         Claude Sonnet (Anthropic)  Analysis, generation, scripts
AI (images)       gpt-image-1.5 (OpenAI)  Background image generation
Text overlay      Sharp / Canvas (Node)   Programmatic text on image
Scraping          Apify API               Instagram hashtag + profile actors
Posting           Postiz API              Instagram draft scheduling
Storage           JSON files (local MVP)  Migrate to DB when scaling
Config            Per-client JSON files   config.json, icp.json, products.json

6.2 APIs Required

API               Status    Usage
──────────────    ───────   ─────────────────────────────────────────
Anthropic         TBD       Analysis + generation (Claude Sonnet)
OpenAI            TBD       Image generation (gpt-image-1.5)
Apify             TBD       Instagram scraping ($5 free credits to start)
Postiz            TBD       Instagram draft posting (postiz.pro)
Instagram         TBD       Connected to Postiz, warmed up 7–14 days

6.3 Project Directory Structure

content-machine/
├── app/                          ← Next.js App Router
│   ├── (dashboard)/
│   │   ├── clients/              ← Client management
│   │   ├── scraping/             ← Scraping results per client/niche
│   │   ├── analysis/             ← Pattern analysis per niche
│   │   ├── generation/           ← Hook + script generation
│   │   ├── creation/             ← Image creation + preview
│   │   └── queue/                ← Post queue (approve/reject/schedule)
│   └── api/
│       ├── scrape/               ← Apify triggers
│       ├── analyze/              ← Claude analysis
│       ├── generate/             ← Hook + script generation
│       ├── create/               ← Image generation
│       └── post/                 ← Postiz integration
├── lib/
│   ├── apify.ts                  ← Apify client wrapper
│   ├── claude.ts                 ← Anthropic client wrapper
│   ├── openai.ts                 ← OpenAI client wrapper
│   ├── postiz.ts                 ← Postiz client wrapper
│   └── image-composer.ts        ← Text overlay on generated images
├── config/
│   └── clients/
│       └── {client_id}/
│           ├── config.json       ← Name, Instagram handle, niches
│           ├── icp.json          ← Ideal customer profile
│           └── products.json     ← Info products being promoted
└── data/
    └── clients/
        └── {client_id}/
            ├── scraped/
            │   └── {niche}-{date}.json
            ├── patterns/
            │   └── {niche}-patterns.json
            └── posts/
                └── {date}/
                    └── {post_id}/
                        ├── script.json
                        ├── background.png
                        ├── final.png
                        └── metadata.json

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PART 7: LARRY METHODOLOGY (What We Apply)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Note: Larry is a .mdc skill file from ClawHub (clawhub.ai/OllieWazza/larry).
It is a methodology document — NOT a codebase to inherit.
We apply its principles adapted to Conny's niche (not interior design).

7.1 Hook Formulas (Adapted for Workplace Niche)

Tier 1 — Person + Conflict + Revelation (BEST)
  Original Larry: "I showed my landlord what AI thinks our kitchen should look like"
  Adapted:
    "My boss told me I'd never get promoted so I showed him this"
    "My colleague kept talking over me until I learned this one thing"
    "My manager said I was 'too emotional' so I sent him this"

Tier 2 — Relatable Situation Pain
  Original Larry: "POV: You have good taste but no budget"
  Adapted:
    "POV: You're trusted with work but never invited to the meetings"
    "POV: It's 16:52 and your boss sends an urgent request"
    "POV: You're the smartest one there but nobody listens"

Tier 3 — Curiosity / Self-Discovery
  Original Larry: "I've always wondered what I'd look like with..."
  Adapted:
    "I had to know if I was the problem at work"
    "Everyone's talking about setting boundaries but would it actually work?"
    "I tested this communication hack for 30 days — here's what happened"

What DOESN'T Work (This Niche):
  - Generic advice without a specific situation: "Communication is important"
  - Abstract statements without tension: "My job is stressful"
  - Victim framing without resolution: "My boss is toxic" (no path forward)
  - Lecture tone: "Today I want to teach you about..."

7.2 Text Overlay Rules (CRITICAL — From Larry, Platform-Agnostic)

Position:   30% from top (NOT center)
            Top 10% = hidden by Instagram UI
            Bottom 20% = hidden by caption/buttons

Font size:  6.5% of image width
            ~66px on 1024px image
            Too small = unreadable on phones

Outline:    15% of font size, thick black
            Readable on ANY background color

Lines:      4–6 words max per line
            Use manual line breaks
            3–4 lines per slide
            Short = scannable in 0.5 seconds

Style:      REACTIONS, not labels
            ✅ "Wait... this hit differently"
            ✅ "I wasn't ready for this"
            ❌ "Workplace communication insight"
            ❌ "Leadership tip #3"

7.3 Caption Template (Adapted for Info Products)

[hook matching visual] [relatable emoji] [2–3 sentences of situation people recognize].

Then I [discovered/realized/tried] [the thing] and [what changed].

[Key insight in 1-2 lines]. [Practical takeaway or script example].

[Emotional closer — validation or mini-provocation]

Comment "[keyword]" if you want [the resource/framework/training].
#[niche1] #[niche2] #[niche3] #[niche4] #[niche5]

Rules:
  - Conversational, tell a mini-story
  - No jargon, no corporate speak
  - Product/offer mentioned naturally, NOT salesy
  - Max 5 hashtags
  - CTA uses keyword trigger (builds DM automation potential later)

7.4 Posting Workflow (NON-NEGOTIABLE)

Posts go to Instagram as DRAFTS (SELF_ONLY privacy) via Postiz.
Silas manually adds trending sound before publishing.
This step cannot be skipped — trending audio = 10x+ reach.
Time required: ~30 seconds per post.

Music selection:
  Open Instagram → Drafts → Tap "Add sound"
  Browse trending in niche, pick popular one → Publish

7.5 Analytics Diagnostic Framework

Views     Conversions    Action
──────    ───────────    ─────────────────────────────────────────
High      High           SCALE — create 3 variations immediately
High      Low            FIX CTA — hook works, downstream broken
Low       High           FIX HOOKS — CTA works, need more reach
Low       Low            FULL RESET — new angle, new hook tier

Decision thresholds:
  50K+ views  → Double down, 3 variations immediately
  10K–50K     → Good, keep in rotation
  1K–10K      → Try 1 more variation
  <1K (twice) → Drop, try radically different hook

7.6 What We Keep vs What We Change

What we keep from Larry:
  ✅ Hook formulas (adapted to workplace niche)
  ✅ Text overlay rules (exact: 30% top, 6.5% font, thick outline)
  ✅ Draft posting workflow (Postiz → music manually)
  ✅ Analytics diagnostic framework
  ✅ Caption structure (mini-story + keyword CTA)
  ✅ gpt-image-1.5 for image generation

What's different from Larry:
  Larry                         Our System
  ────────────────────          ────────────────────────────────
  Interior design niche         Workplace/leadership niche
  TikTok primary                Instagram Reels primary
  App marketing (single app)    Info products (multi-niche)
  Single user                   Multi-client (Silas manages many)
  6-slide carousel structure    7-sec static slide + 60-sec talking head

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PART 8: SCRAPING STRATEGY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

8.1 Why Apify

Tool         Instagram Hashtags    Cost (10K posts)    Verdict
──────────   ──────────────────    ────────────────    ────────────
Apify        ✅ Works              $4–8                ✅ Best choice
Bright Data  ✅ Works              $20–50              Enterprise overkill
ScrapingBee  ✅ Works              $10–20              Reasonable backup

Why Apify: Pre-built actors, handles blocks automatically, 95%+ success,
$5 free credits to start, clean API integration.

8.2 Dual Scraping Strategy

Track A — Hashtag Search (Niche Discovery)
  Input: Keywords from Conny's 3 niches (workplace communication, psychology, authority)
  Filter: Last 7 days, minimum views threshold
  Purpose: Find viral content in the broad niche space
  Outlier criteria: Absolute view count (no baseline, top 10% of results)
  Example hashtags:
    #workplacecommunication #toxicboss #officepolitics #workplacepsychology
    #boundariesatwork #corporatelife #leadershiptips #difficultconversations

Track B — Competitor Profile Scraping (Deep Analysis)
  Input: 4 reference accounts (listed in Part 3.5)
  Extract: Top posts sorted by views
  Purpose: Understand what's working for direct competitors
  Outlier criteria: Posts with 10x+ the account's average views
  Frequency: Weekly scrape of each account

Output format per post:
  {
    "post_id": "",
    "url": "",
    "account": "",
    "account_avg_views": 0,
    "views": 0,
    "likes": 0,
    "comments": 0,
    "saves": 0,
    "shares": 0,
    "outlier_ratio": 0.0,
    "hook_text": "",
    "caption": "",
    "hashtags": [],
    "post_date": "",
    "format": "reel|image",
    "source": "hashtag|profile",
    "niche": ""
  }

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PART 9: CONNY'S CLIENT CONFIG (Starter)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

config.json
  client_id: "conny-gfrerer"
  name: "Conny Gfrerer"
  instagram: "@connygfrerer"
  niches: ["workplace-communication", "workplace-psychology", "personal-authority"]
  posting_frequency: TBD with Silas
  language: German (content), English (system)
  competitor_accounts:
    - eloisegagnon_strategist
    - thebigapplered
    - corporateclarity.career
    - heyworkfriend

icp.json
  target: Professionals dealing with difficult workplace dynamics
  age: 28–45 (estimate)
  pain_points:
    - Toxic or insecure boss
    - Being overlooked despite strong work
    - Unable to set boundaries without conflict
    - Passive-aggressive colleagues
    - Feeling politically disadvantaged at work
  desires:
    - Be heard and respected at work
    - Set boundaries without losing relationships
    - Communicate with authority and calm
    - Understand workplace dynamics before being affected

products.json
  (TBD — Silas to confirm: course / coaching / PDF / live training)
  Known: Conny offers training on communication × inner stability

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PART 10: MVP DEFINITION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

What "working" looks like at Phase 1 completion:
  1. Silas opens the web app (Vercel URL)
  2. Selects Conny's profile
  3. Clicks "Scrape" → Apify runs → scraped posts appear in dashboard
  4. Posts are ranked by views/outlier ratio
  5. Silas can view each post's hook, caption, metrics
  6. Claude analyzes the batch → patterns rendered per niche
  7. Silas reviews patterns before moving to generation

That's the Phase 1 definition of done.
Each subsequent phase adds one more step to this chain.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PART 11: OPEN QUESTIONS (Resolved + Remaining)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

RESOLVED:
  ✅ Who operates it → Silas, manually via dashboard
  ✅ First client → Conny Gfrerer (communication/leadership niche)
  ✅ B-roll format → Static image slides (gpt-image-1.5 background + text overlay)
  ✅ Talking head → System generates script, Conny films herself
  ✅ Scraping strategy → Both hashtag (discovery) + competitor profiles (analysis)
  ✅ Dashboard → Next.js web app, deployed on Vercel
  ✅ Multi-client → Architecture supports it from day 1, Conny is client #1
  ✅ Larry → .mdc skill file (methodology), not code to inherit
  ✅ Visual style → Atmospheric background (office/workplace/abstract) + text overlay

STILL OPEN:
  ⏳ Conny's exact product (course? coaching? PDF? live training?)
  ⏳ Posting frequency Silas wants to achieve (posts/week per client)
  ⏳ Language of the content (German or English? Conny's IG is German)
  ⏳ Budget: monthly API spend limit
  ⏳ Apify and Postiz accounts — need to be set up before testing
  ⏳ Instagram account — needs connecting to Postiz + warm-up period

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PART 12: BUILD ORDER / NEXT STEPS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ Master plan documented (this file)
✅ Niche strategy defined (Conny: 3 niches, 2 formats, competitor accounts)
✅ Methodology mapped (Larry adapted to workplace niche)

⏳ NEXT: Phase 1A — Dashboard scaffold
    - Initialize Next.js project
    - Client config system (Conny as first client)
    - Navigation shell for all pipeline phases
    - Scraping results UI (ready to receive Phase 1B data)

⏳ NEXT: Phase 1B — Scraping integration
    - Apify client wrapper
    - Hashtag scraper + profile scraper
    - Results stored per client/niche
    - Outlier detection logic
    - Display in dashboard

⏳ LATER: Phase 2 — Analysis (Claude)
⏳ LATER: Phase 3 — Generation (hooks + scripts)
⏳ LATER: Phase 4 — Creation (gpt-image-1.5 + text overlay)
⏳ LATER: Phase 5 — Posting (Postiz API)
