# Auto-Optimization Research & Patterns

> Reference material for Phase 4 (auto-learning / self-improvement).
> Sources: Karpathy's `autoresearch` repo + multi-agent content pipeline patterns.
> Local clone: `~/dani/autoresearch/`

---

## 1. The Autoresearch Pattern (Karpathy)

### Core Idea
An AI agent autonomously runs experiments on a **single mutable file**, with a **fixed evaluation budget** and **immutable metrics**, using **git keep/discard** to ratchet forward. The human writes the *process* (`program.md`), the agent iterates on the *product* (`train.py`).

### The Loop
```
1. Establish baseline (run current version, record metric)
2. LOOP FOREVER:
   a. Propose change (one idea per iteration)
   b. Edit the file
   c. Git commit
   d. Run experiment (fixed time/resource budget)
   e. Extract metric
   f. IF improved → keep commit, advance branch
      IF worse/equal → git reset to last good state
      IF crash → attempt fix or skip
   g. Log to results.tsv (commit, metric, status, description)
   h. Repeat
```

### Why It Works — 5 Non-Negotiable Design Decisions

| Principle | Why It Matters |
|-----------|---------------|
| **Fixed budget per experiment** | Makes every run comparable regardless of what changed |
| **Single immutable metric** | Prevents gaming; the agent can't redefine "good" |
| **Evaluation code is frozen** | Agent optimizes *against* the metric, can't modify *how* it's measured |
| **Git-based checkpointing** | Clean rollback, full audit trail, branch only advances on improvement |
| **Simplicity criterion** | Rejects ugly complexity even if metric improved marginally |

### What the Human Controls
- `program.md` — the meta-instructions (what to try, what to avoid, how to evaluate)
- The human iterates on the *process*, reviews `results.tsv`, adjusts strategy
- The agent never stops to ask permission — runs until interrupted

---

## 2. Multi-Agent Specialized Pipeline Pattern

### Core Idea
Instead of one agent doing everything, break the pipeline into **specialized agents with gates** — each agent has one job, a quality bar, and a "manager" that blocks advancement until the bar is met.

### The Pipeline Structure
```
Research Agents (parallel)
  → Platform-specific data collection
  → Output: indexed "ammunition" (patterns, quotes, pain points)

Sequential Writing Agents (with gates)
  → Hook Agent → Hook Manager (gate: score across N dimensions)
  → Body Agent → Body Manager (gate)
  → CTA Agent → CTA Manager (gate)
  → Each agent iterates minimum 3x with diagnosis before gate check

Quality Check (final)
  → Per-line scoring on 2+ independent dimensions
  → Lines that fail get rewritten or cut
  → Hard character/time budgets enforced
```

### What's Actually Real vs. Marketing

**Genuinely useful patterns:**
- Specialized agents > one general agent (proven in practice — focused context = better output)
- Gate pattern between stages (prevents garbage from propagating downstream)
- Research-first before generation (data-backed > vibes-based)
- Iterative rewriting with explicit diagnosis of what's weak before rewrite
- Hard constraints (character budgets, time limits) that force density
- Per-line quality review as a separate pass

**Claims that need scrutiny:**
- "10/10 scoring" — LLM scoring its own output is circular without external ground truth. The score means nothing absolute; it only works as a relative filter (better/worse than previous iteration). Real validation requires human review or downstream metrics (views, engagement).
- "20 agents" — likely 5-7 distinct *roles* with some running multiple instances or iterations. The number is less important than the specialization.
- "Better than any human" — marketing claim. The system likely produces *more consistent* output at *higher volume*, not objectively "better" than a top human writer.
- "$3M/$10M revenue attribution to scripts" — impossible to isolate. Product quality, audience size, distribution, timing, offer structure all matter more than script quality alone. A great script for a bad product still fails.
- "Trained on our writing" — most likely few-shot examples in context, not fine-tuning. Still effective but not magic.

---

## 3. How This Maps to Silas

### What We Already Have (Phases 1-2)
- Research phase: Apify scraping competitors + outlier detection ✅
- Analysis: Claude scoring reels against 5 criteria ✅
- Data: historical reel performance metrics from Instagram ✅

### Where Auto-Optimization Applies

#### A. Prompt Optimization (Near-term, Phase 2 enhancement)

**Target:** The analysis prompts that score reels against 5 criteria.

**Autoresearch pattern applied:**
- `train.py` equivalent → the analysis prompt template
- Metric → correlation between AI score and actual reel performance (views/saves/shares)
- Evaluation harness → run prompt against known outliers vs. non-outliers, measure prediction accuracy
- Keep/discard → git-based, only advance if prediction accuracy improves

**Ground truth available:** YES — we have historical reels with real view counts AND AI analysis scores. We can measure whether the prompt correctly identifies top performers.

**Feasibility: HIGH** — we have the data, the metric is measurable, the iteration is cheap (API calls, not GPU training).

#### B. Hook/Script Generation (Medium-term, Phase 3)

**Target:** The prompts that generate hooks and scripts from analyzed patterns.

**Multi-agent pattern applied:**
- Specialized agents: Hook generator, script writer, quality reviewer
- Gate pattern: reviewer agent scores output, sends back for rewrite if below threshold
- Research integration: analyzed outlier patterns feed directly into generation context

**Ground truth available:** PARTIALLY — human approval rate is measurable immediately. Real engagement data only available after Phase 5 (posting) is live and enough reels have been published.

**Feasibility: MEDIUM** — the generation pipeline works, but without a closed feedback loop (post → measure → improve) it's human-in-the-loop only. No autonomous optimization until we can measure real engagement.

#### C. Full Closed-Loop Optimization (Long-term, Phase 4-5)

**Target:** The entire pipeline — from what patterns we look for, to how we analyze them, to how we generate content.

**Requires:**
1. Phase 5 (posting) operational
2. Enough published reels to have statistically meaningful performance data (minimum ~50-100 reels across different pattern types)
3. Attribution tracking: which analysis insights led to which generated content led to which performance

**Autoresearch pattern applied at scale:**
- Fixed evaluation: engagement metrics (views, saves, shares, comments) measured at day 7 and day 30 post-publish
- Mutable files: analysis prompts, generation prompts, scoring weights, pattern selection criteria
- Keep/discard: only advance prompts that produce content with better engagement than baseline

**Feasibility: HIGH but TIME-DELAYED** — the architecture supports it, but we need the data flywheel spinning first (Phase 5 live + ~2-3 months of data).

---

## 4. Concrete Implementation Approach

### Phase 2 Enhancement (NOW)

```
Step 1: Build evaluation harness
  - Pull all reels with both: (a) AI analysis scores and (b) real view data
  - Define metric: rank correlation between AI score and actual views
  - Freeze this evaluation code

Step 2: Create prompt optimization loop
  - Current analysis prompt → baseline score
  - Agent proposes prompt modification
  - Run against evaluation set
  - Keep if correlation improves, discard if not
  - Log everything to results.tsv

Step 3: Human review
  - Review results.tsv periodically
  - Adjust meta-instructions (what kinds of changes to try)
  - Approve/reject prompt changes before they go to production
```

### Phase 3 Enhancement (AFTER Generation Pipeline Works)

```
Step 1: Add gate pattern to generation
  - Hook agent generates → reviewer agent scores → iterate or pass
  - Track iteration count and pass rate per gate

Step 2: Human-in-the-loop scoring
  - Generated scripts get rated by Conny/client (1-5 scale)
  - This becomes the ground truth for generation prompt optimization

Step 3: Apply autoresearch loop to generation prompts
  - Metric: average human rating of generated scripts
  - Same keep/discard pattern as Phase 2
```

### Phase 4 Full Loop (AFTER Phase 5 is Live + Data Accumulates)

```
Step 1: Connect the feedback loop
  - Published reel → Instagram metrics at day 7/30
  - Trace back: which patterns → which analysis → which generation → which performance

Step 2: Multi-objective optimization
  - Not just views — saves, shares, comments, follower growth
  - Weighted score defined with client input

Step 3: Autonomous optimization with human checkpoints
  - Agent runs experiments on prompts overnight
  - Human reviews results weekly
  - Approved changes get promoted to production
```

---

## 5. Blind Spots & Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| **LLM scoring LLM output is circular** | HIGH | Always validate against real-world metrics (views, engagement), never trust LLM self-scores as absolute truth |
| **Small sample size** | HIGH | Need 50-100+ reels before any optimization is statistically meaningful. Premature optimization on 10 reels = noise-fitting |
| **Instagram algorithm changes** | MEDIUM | What works today may not work in 3 months. Evaluation harness needs periodic recalibration against recent data (rolling window, not all-time) |
| **Overfitting to one client's niche** | MEDIUM | Patterns that work for Conny (leadership/communication) may not transfer. When adding clients, start with fresh baseline |
| **Attribution complexity** | HIGH | A reel's performance depends on: content quality + posting time + trending audio + hashtags + algorithm mood. Script quality is ONE variable. Don't over-attribute |
| **Metric gaming** | MEDIUM | If the system optimizes purely for views, it may drift toward clickbait. Include quality signals (saves, shares, comments) not just reach |
| **Complexity creep** | MEDIUM | Karpathy's simplicity criterion applies — reject changes that add ugly complexity even if they marginally improve metrics. Keep the system understandable |
| **Human bottleneck** | LOW | Human-in-the-loop is correct for now. Full autonomy only after the system has proven reliable over months of supervised operation |

---

## 6. Key Takeaways

1. **Don't optimize what you can't measure.** Until we have real engagement data flowing back, auto-optimization is just prompt-shuffling with no ground truth.

2. **The evaluation harness is the product.** Getting the measurement right matters more than the optimization loop itself. A clean metric + simple keep/discard beats a sophisticated optimizer with a fuzzy metric.

3. **Start with the cheapest experiment.** Phase 2 prompt optimization against historical data is nearly free and immediately valuable. Do this before building anything complex.

4. **Specialization > monolithic agents.** For generation (Phase 3), break into focused agents with gates. But don't over-engineer — 3-5 specialized agents with clear roles beats 20 agents for the sake of a bigger number.

5. **The human writes the process, not the content.** The highest-leverage work is designing the evaluation criteria and meta-instructions, not reviewing individual outputs.

6. **Patience.** The closed-loop optimization (Phase 4) needs Phase 5 live + months of data. Don't rush it — premature optimization on insufficient data is worse than no optimization.

---

## 7. Is the 20-Agent Pipeline Actually the Smartest Approach for Silas?

> **Short answer: No. Not for this specific system. Here's why.**

### The Tweet is Optimizing the Wrong Variable

The tweet pipeline is built for **product launch scripts** — one high-stakes video per product, written by Emmy-winning copywriters, optimizing every single word for maximum conversion.

Silas is producing **2-5 Instagram Reels per week** for a creator who **films herself**. The constraints are completely different.

The tweet optimizes **copywriting quality** (word-level, per-line intensity scores).
Silas needs to optimize **angle/insight quality** (idea-level, is this genuinely novel and specific?).

**These are different problems. The solution to one does not transfer to the other.**

---

### The Real Variable That Drives Views in Conny's Niche

A mediocre script on a **genuinely novel, specific angle** → 500K views
A perfect 10/10 script on a **generic angle** → 10K views

The angle is the leverage point. Not the per-line copy intensity.

In the workplace niche specifically:
- ✅ *"POV: Your boss CCed your colleague on your email again"* → instantly relatable, specific conflict
- ❌ *"Today we talk about assertive communication"* → generic, no tension, no scroll-stop

No amount of per-line weapons-checking by an AI agent will turn a generic angle into a viral reel. But a specific, novel angle with a rough script still performs.

---

### The Conny-Specific Blind Spot the Tweet Completely Ignores

**Conny films herself.** She delivers these scripts on camera.

A 10/10 LLM-scored script that doesn't sound like how Conny actually speaks is **worthless** — she'll rewrite it before filming, or it'll feel stilted on camera and the delivery will kill the reel regardless of word quality.

The biggest failure mode for AI-generated talking head scripts isn't copy quality — it's **voice mismatch**. If the system doesn't have real examples of Conny's actual content and speech patterns, every agent in the pipeline is generating content that sounds like "generic LinkedIn workplace content," not Conny.

This means:
- Voice calibration is a prerequisite, not an afterthought
- Conny's review is the only reliable quality gate (not a Hook Manager agent)
- The generation pipeline's goal is **raw material Conny can edit into her voice** — not a finished product

---

### What the 20-Agent Pipeline Gets Right (Actually Applicable to Silas)

| Pattern | Applicable? | How |
|---------|-------------|-----|
| Research-first before generating | ✅ YES | Already have this via Apify. Must stay. |
| Specialized roles (not one mega-agent) | ✅ YES | But 3-4 roles, not 20 |
| Gate at angle selection | ✅ YES | Human gate (Silas picks angle), not LLM self-scoring |
| Iterative rewriting with diagnosis | ⚠️ PARTIAL | Only useful if Conny provides feedback on what's wrong |
| Per-line weapons check | ❌ NO | Wrong granularity for 150-word talking head scripts |
| Fixed 3-iteration minimum | ❌ NO | Arbitrary. Iterate until Conny approves, not until agent hits 10/10 |
| 10/10 LLM self-scoring | ❌ NO | Circular. Only real score is views + Conny's comfort on camera |

---

### The Actually Smarter Architecture for Silas (Phase 3)

**Format B — 60-sec Talking Head Script (the harder, more valuable one):**

```
Step 1 — Research Output (Phase 2, already done)
  → Structured patterns: top hook types, emotional triggers, viral angles

Step 2 — Angle Agent
  → Input: research patterns + ICP + Conny's niche + recent scrape data
  → Output: 5 specific, novel angles (NOT generic topics)
  → What "specific" means: includes a concrete situation, not just a topic
    ✅ "Your boss asks for feedback but punishes honesty"
    ❌ "Toxic leadership patterns"
  → This is the highest-leverage step. Most effort goes here.

Step 3 — HUMAN GATE: Silas picks the angle
  → This is non-negotiable. A human who knows Conny picks here.
  → No LLM scores this. Silas knows what Conny's audience responds to.

Step 4 — Script Agent
  → Input: chosen angle + Conny voice examples + ICP + hook tier formulas
  → Output: full script with 5-part structure (hook/context/3 insights/CTA)
  → Written in Conny's voice — requires real examples of her content

Step 5 — HUMAN GATE: Conny reviews and edits
  → She adjusts language to her natural speech patterns
  → She can flag what felt wrong → system stores this as feedback
  → She films

Step 6 — Feedback loop (Phase 4+)
  → After posting: views at day 7 and day 30 stored against which angle/script
  → This becomes the ground truth for future angle/script prompt optimization
```

**Format A — 7-sec Static Slide (simpler, fully automated):**

```
Step 1 — Research Output → patterns
Step 2 — Hook Agent → 10-15 hooks across Tier 1/2/3 structures
Step 3 — Silas picks hook
Step 4 — System auto-generates: overlay text + full caption + hashtags
Step 5 — Silas reviews final image → approves → queue
```

This is 3-4 agents total, with 2 clear human checkpoints. No LLM self-scoring required.

---

### The Agents Worth Specializing (and Why)

| Agent | Job | Why Specialized |
|-------|-----|-----------------|
| **Angle Agent** | Generates 5 specific, novel angles from research | Needs full research context + ICP. Different from writing. |
| **Script Agent** | Writes full script from chosen angle | Needs Conny voice examples + hook formulas. Focused context = better output. |
| **Hook Agent** (Format A) | Generates hooks across all 3 tiers | Hook-only context produces better hooks than a general script agent |
| **Caption Agent** (Format A) | Full caption from hook | Needs ICP + mini-story structure |

That's it. 4 agents. Each with a clear job and clear inputs/outputs.

---

### What Makes This Better Than the 20-Agent Approach for Silas

1. **Angle quality is the bottleneck, not copy quality** — we optimize where leverage lives
2. **Human gates where human judgment is irreplaceable** — Silas at angle selection, Conny at script review
3. **No circular self-scoring** — LLMs don't grade themselves, humans and real metrics do
4. **Voice calibration baked in** — system needs Conny's examples before it can generate useful scripts
5. **Feedback loop is concrete** — Conny's edit distance + post performance = real optimization signal
6. **Right tool for right format** — Format A (word-level hook quality matters) vs Format B (insight quality matters)

---

### Action Required Before Phase 3 Can Work

Before building the generation pipeline, these inputs are needed:

- [ ] **Conny voice examples** — 5-10 actual scripts from her best-performing reels (Silas to pull from existing content)
- [ ] **Conny's product details confirmed** — can't write CTAs without knowing what she's selling
- [ ] **Confirmed content language** — German or English? (Her IG is German — this changes everything about the prompts)
- [ ] **Silas defines "good angle"** — need 3-5 examples of angles that worked vs. didn't in Conny's niche

Without these, Phase 3 will generate generic workplace content that neither Conny's voice nor her audience.
