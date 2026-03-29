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
