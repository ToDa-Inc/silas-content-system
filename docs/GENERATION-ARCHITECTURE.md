# Content generation — how it works and why

This document explains the **outlier-driven generation** path in Silas: what problem it solves, how the flow works, what it depends on, and why it’s built the way it is. It’s meant for anyone who needs to *reason* about the product, not only for engineers reading code.

---

## What this feature is for

The goal is **not** to replace a strategist or the creator. It’s to turn **real intelligence** (scraped reels, saved analyses, client context) into **draft copy** the team can review: angles first, then hooks, a talking-head script, caption, hashtags, and short lines for Stories.

Everything is grounded in **data you already collected** — not in a generic “write me a post about leadership” prompt.

---

## The problem with the naive approach

A simple “generate hooks” button that only knows a niche label will produce **generic** text. It might sound polished and still be useless on Instagram, because **the idea** (the angle) matters more than word polish.

So the architecture pushes effort to:

1. **Understanding what’s working** in the niche (from your analyses).
2. **Proposing strong angles** (specific situations, not vague topics).
3. **Writing copy** only *after* a human picks an angle.

That order matches how a senior strategist actually works: research → angle → execution.

---

## What feeds the system (inputs)

Before generation runs well, these pieces should be in good shape:

- **Saved reel analyses** — From Intelligence: you’ve run Silas analysis on competitor or viral reels. Those rows hold scores, “why it worked,” replicable elements, and excerpts of the full model output.
- **Client DNA** — Compiled briefs (`generation_brief`, `voice_brief`, `analysis_brief`) built from the client profile, ICP, niche config, and the “client brain” (including offer text when filled in). This is how the model knows *who* it’s writing for and *how* they should sound.
- **Language** — The client’s content language (e.g. German) is respected so output matches the audience, not a default English template.

If analyses or DNA are thin, you’ll still get structured output — but it will feel more generic. The system can’t invent a voice or niche you never captured.

---

## The flow, step by step

### 1. Choose a source

The user picks how to anchor the run:

- **Top patterns** — Use a batch of the best-scoring saved analyses for this client (breadth).
- **Selected analyses** — Hand-pick specific analyses (tight link to particular outliers).
- **Manual focus** — Same idea as top patterns, plus an optional note (“focus on boundaries with your boss,” etc.).

This choice is stored so you can trace *what* inspired a session later.

### 2. Pattern synthesis (first model pass)

The system sends the client context plus a **compact summary** of each chosen analysis into the model. The model’s job is **not** to write posts yet. It’s to **synthesize**: recurring hook patterns, tension devices, how value is delivered, what to avoid, and a short narrative summary.

Think of it as: *“Given these diagnoses, what are the repeatable mechanics?”*

### 3. Angle generation (second model pass)

Using that synthesis **plus** the same client briefs, the model proposes **five angles**. Each angle is supposed to be a **concrete situation** the ideal viewer recognizes — aligned with the briefs, not a bland theme like “communication tips.”

This is intentionally a **separate** call from pattern synthesis: different job, clearer instructions, less noise in the context.

### 4. Human gate: pick one angle

A person (Silas / operator) picks **one** angle. No model scores this step; human judgment is the gate. That matches the product reality: you know the client and the calendar better than any score.

### 5. Content package (third model pass)

With the **chosen angle** and the same patterns + DNA, the model produces:

- Many **hooks** (tagged by tier: question-style, tension/insight, concrete script/list style).
- A **~60s talking-head script** in sections (hook, situation, insights, conclusion, CTA).
- **Caption body** and **hashtags** (capped so it stays usable on Instagram).
- A few **Story** line variants.

Again: one coherent package tied to one angle, in the client’s language and voice cues from the briefs.

### 6. Review, regenerate, approve or reject

The user can **regenerate** the whole package or only part of it (hooks, script, caption, stories) and optionally add short feedback. The backend still runs one model call for the package, then **keeps** the parts you didn’t ask to change — so you don’t pay complexity in the UI for a perfect multi-agent split.

**Approve** and **reject** are simple status flags for workflow and later learning; optional feedback text can be stored for future prompt tuning.

---

## Why three model passes instead of one giant prompt

- **Focus** — Each step has one job. Mixed instructions (“analyze, then invent angles, then write everything”) tend to produce mediocre everything.
- **Quality where it matters** — Most leverage is in **angles** and **pattern synthesis**. Isolating them makes failures easier to see and fix (prompt or data), instead of one blob of output.
- **Human control** — Stopping after angles lets a human cut bad ideas before you burn time on full scripts.

This is the same instinct as a pipeline with quality gates, without pretending that an LLM can replace the strategist at the angle step.

---

## What gets saved (sessions)

Each run is stored as a **session** row: source references (which analyses), the pattern snapshot, all angles, which angle was chosen, the final copy fields, status, and which **prompt version** was used.

That matters for:

- **Traceability** — “This script came from these analyses and this angle.”
- **Iteration** — Comparing sessions when you change prompts.
- **Future learning** — When posting and performance data exist, you can link outcomes back to sessions (later phases).

---

## What makes this a “senior” approach (in product and engineering terms)

- **Ground truth first** — Generation consumes analyses and DNA, not vibes.
- **Separation of concerns** — Synthesis vs angles vs copy; human gate on the angle.
- **Honest about limits** — LLM self-scoring isn’t used as a fake quality metric; humans and (later) real engagement matter.
- **Practical scope** — One table for the workflow, clear API, regenerate by scope without building twenty micro-agents.
- **Explicit versioning** — Prompt version is recorded so improvements are auditable.

It’s senior in the sense of **clarity, traceability, and matching the real creative process** — not in the sense of adding complexity for its own sake.

---

## What we deliberately did not build (yet)

- **Auto-picking the “best” angle** with model scores — avoided because those scores aren’t ground truth without human or performance data.
- **A separate table per asset type** — unnecessary for how the product reviews and exports copy.
- **Tight coupling to posting** — manual posting is still the plan; linking published posts to sessions is a natural next step when that data exists.

---

## Short glossary

- **Analysis** — A saved Silas breakdown of one reel (scores + narrative + replicable elements).
- **Pattern synthesis** — A structured summary across several analyses.
- **Angle** — A specific, audience-recognizable situation or framing for a piece of content, not a vague topic.
- **Session** — One generation run from source choice through optional approve/reject.

---

## Where to look in the repo (for implementers)

- SQL: `backend/sql/phase6_generation_sessions.sql` — session storage shape.
- Logic: `backend/services/content_generation.py` — prompts and pipeline steps.
- API: `backend/routers/generation.py` — start, choose angle, regenerate, list/get, approve/reject.
- UI: `content-machine` Generate page and `api-client` helpers for the same endpoints.

If this document and the code disagree over time, **treat the code as source of truth** and update this file when behavior changes on purpose.
