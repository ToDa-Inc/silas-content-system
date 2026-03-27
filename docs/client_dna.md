# Client DNA — Pre-compiled Context Briefs

## What this is

Every pipeline that touches client-specific content (reel analysis, hook generation,
script writing) needs to know who the client is, who their audience is, and what
content works for them. Today that context lives in two places:

- **Source A** — `niche_config` (JSONB array) + `icp` (JSONB dict) on `clients`.
  Structured bullet points from auto-profile or onboarding wizard. Shallow but
  structured.
- **Source B** — `client_context` (JSONB dict) on `clients`. Deep prose sections
  from onboarding transcript, uploads, or manual entry: ICP, brand map, story board,
  communication guideline, offer documentation. Rich but verbose (can be 10-20k tokens).

Neither source is ready to inject into a prompt as-is. Source A is too shallow.
Source B is too long and not task-optimized.

**Client DNA** solves this: one LLM call reads ALL sources and compresses them into
3 task-specific briefs (~800-1200 tokens each). Each pipeline injects only the brief
it needs. Compressed once per client update, used thousands of times.

## Terminology

| Internal key         | UI label            | Purpose                                          |
|----------------------|---------------------|--------------------------------------------------|
| `analysis_brief`     | Analysis brief      | Injected into reel analysis prompts. Calibrates scoring for this client's niche and audience. |
| `generation_brief`   | Generation brief    | Injected into content generation prompts (hooks, captions, ideas). Brand voice + angles. |
| `voice_brief`        | Voice brief         | Injected into script writing prompts. How the client talks, sentence patterns, vocabulary. |

Stored as `clients.client_dna` JSONB column:

```json
{
  "analysis_brief": "...",
  "generation_brief": "...",
  "voice_brief": "...",
  "source_hash": "a1b2c3d4e5f6g7h8",
  "compiled_at": "2026-03-27T14:30:00Z",
  "compiled_by": "google/gemini-2.0-flash-001"
}
```

## Architecture

```
Source A (niche_config + icp) ──┐
                                ├─→ LLM compaction ─→ client_dna.analysis_brief
Source B (client_context)    ──┘                   ─→ client_dna.generation_brief
                                                   ─→ client_dna.voice_brief
```

1. Client saves/updates `niche_config`, `icp`, or `client_context`
2. System computes a hash of the source text content (ignoring metadata like timestamps)
3. If hash differs from `client_dna.source_hash`, trigger recompilation (background task)
4. LLM reads all sources → produces 3 briefs as JSON
5. Briefs stored in `clients.client_dna`
6. Downstream prompts read the relevant brief

## Fallback chain (reel analysis)

```
client_dna.analysis_brief  (preferred — rich, compressed, niche-aware)
        ↓ if empty
build_niche_context_block() from Source A  (existing function in reel_analyze_prompt.py)
        ↓ if empty
"No niche context provided. Score for a general professional audience."
```

System never breaks. Analysis runs with whatever context is available.

---

## Implementation steps

### Step 1: Migration — `backend/sql/phase5_client_dna.sql`

```sql
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS client_dna jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN clients.client_dna IS
  'Pre-compiled context briefs for LLM prompts. Regenerated when niche_config,
   icp, or client_context changes. Keys: analysis_brief, generation_brief,
   voice_brief, source_hash, compiled_at, compiled_by.';
```

### Step 2: Model update — `backend/models/client.py`

Add to `ClientOut`:
```python
client_dna: Optional[dict] = None
```

Do NOT add `client_dna` to `ClientCreate` or `ClientUpdate` — it's machine-generated,
not user-settable via the client CRUD endpoints. (A separate endpoint handles manual
brief edits if needed.)

### Step 3: Compaction service — `backend/services/client_dna_compile.py`

New file with:

**A) `_build_source_dump(client_row: dict) -> tuple[str, str]`**
- Reads `niche_config`, `icp` from the client row → formats as labeled text block (Source A)
- Reads `client_context` → extracts `.text` from each section, ignoring metadata → formats as labeled text block (Source B)
- Returns `(source_a_dump, source_b_dump)`

**B) `_compute_source_hash(client_row: dict) -> str`**
- Extracts text content only from `niche_config`, `icp`, and each `client_context[section].text`
- Hashes with SHA-256, returns first 16 hex chars
- IMPORTANT: strip `updated_at`, `source`, `file` from each section before hashing.
  Otherwise the hash changes on every save even when text didn't change.

**C) `compile_client_dna(openrouter_key: str, model: str, client_row: dict) -> dict`**
- Calls `_build_source_dump()` to get the raw context
- If both dumps are effectively empty (no meaningful text), return empty dict (skip LLM call)
- Sends the compaction prompt (see below) to OpenRouter
- Parses JSON response into `{ analysis_brief, generation_brief, voice_brief }`
- Adds `source_hash`, `compiled_at`, `compiled_by`
- Returns the full `client_dna` dict

**D) `maybe_recompile_dna(settings, supabase, client_id: str) -> None`**
- Fetches client row
- Computes current source hash
- Compares against `client_dna.source_hash`
- If different (or `client_dna` is empty), calls `compile_client_dna()` and updates DB
- If compile fails, logs error but does NOT raise — downstream has fallbacks
- Uses `settings.openrouter_model` (the fast model, same as competitor discovery)

### Step 4: The compaction prompt

The LLM output MUST be JSON (not free-form text with delimiters). This matches the
pattern in `client_context_generate.py` and is reliable to parse.

```
SYSTEM:
You are compressing client context into dense, task-optimized summaries called "briefs."
Each brief will be injected into a different AI prompt, so it must be self-contained
and specific to its task.

Read ALL the context below. Source B (client's own words from onboarding) is the
authority — it reflects how the client actually thinks and talks. Source A (auto-generated
profile from Instagram scraping) fills structural gaps. Where they conflict, Source B wins.

Output MUST be a single JSON object with exactly 3 string keys (no markdown fences):

"analysis_brief" — For reel analysis. The AI watching competitor reels needs to know
what "relatable" and "valuable" mean for THIS specific client and audience.
Must include (800-1200 tokens):
• IDENTITY: Who is this client? What do they do? Positioning. One paragraph, specific.
• NICHE BOUNDARIES: What topics are IN scope? What is explicitly OUT of scope?
  Be specific about adjacent niches that are NOT theirs. This prevents false positives —
  reels that look relatable to a general audience but are off-niche for this client.
• TARGET AUDIENCE: Who watches this content? Not demographics — psychographics.
  What situation are they in? What are they feeling when they find this content?
• PAIN POINTS & DESIRES: Specific problems and wants. Use the client's own language
  where possible (from Source B).
• CONTENT THAT RESONATES: What formats, angles, patterns work? What makes them
  save, share, comment? Be specific about the TYPE of value (scripts > theory,
  specific > generic, recognition > inspiration).
• CONTENT THAT DOES NOT WORK: What should score LOW? Generic advice, motivational
  fluff, wrong audience segment, wrong tone. Be specific.
• VOICE & TONE: How does the client communicate? Direct, warm, academic, casual?

"generation_brief" — For content generation (hooks, captions, ideas).
Must include (600-1000 tokens):
• Brand voice and vocabulary (specific phrases the client uses)
• Content angles that perform well
• Hook patterns that fit their style
• Caption structure preferences
• Topics and formats to avoid
• The client's unique perspective (what makes them different in their niche)

"voice_brief" — For script writing (talking head videos).
Must include (400-700 tokens):
• How the client talks (sentence length, formality, directness)
• Recurring phrases or frameworks they use
• How they structure arguments (story first? problem first? provocation?)
• Emotional register (empathetic? authoritative? peer-to-peer?)
• Language (which language, any bilingual patterns)
• What scripts should NEVER sound like (too salesy, too academic, etc.)

If a section of the source context is empty or says "Not covered in transcript,"
write an honest note like "Not enough data to determine X" for that part.
Do NOT invent facts.

USER:
=== SOURCE A: Structured Profile (auto-generated) ===
{source_a_dump}

=== SOURCE B: Client Brain (from onboarding/uploads) ===
{source_b_dump}
```

### Step 5: Trigger recompilation

Three trigger points. All should be async (don't block the API response).
Use `BackgroundTasks.add_task()` which is the existing pattern in the codebase.

**A) `backend/routers/clients.py` — `update_client()` PUT endpoint**

After the update succeeds, check if DNA-relevant fields changed:
```python
dna_fields = {"niche_config", "icp", "client_context"}
if dna_fields & set(patch.keys()):
    background_tasks.add_task(_recompile_dna, client_id)
```

This covers:
- Direct client updates (niche_config, icp changes)
- Context editor saves (client_context changes go through this endpoint)

Requires adding `background_tasks: BackgroundTasks` and `settings: Settings` as
dependencies to the endpoint.

**B) `backend/jobs/client_auto_profile.py` — after niche_config/icp update**

After the job writes `niche_config` and `icp` back to the clients table (~line 190),
call `maybe_recompile_dna()` directly (already in a background job context, no need
for another background task).

**C) Optional: manual "Regenerate" endpoint**

`POST /api/v1/clients/{slug}/dna/regenerate` — forces recompilation regardless of
hash. For when the user edits briefs and wants to reset to auto-generated.

### Step 6: Wire into reel analysis — `backend/jobs/reel_analyze_url.py`

**In `run_reel_analyze_url()` (single URL path):**
- Before calling `_execute_reel_analyze_url_core()`, fetch client data:
  ```python
  client_row = supabase.table("clients") \
      .select("name, instagram_handle, language, niche_config, icp, client_dna") \
      .eq("id", client_id).limit(1).execute()
  ```
- Extract `analysis_brief`:
  ```python
  dna = (client_row.data[0].get("client_dna") or {}) if client_row.data else {}
  analysis_brief = dna.get("analysis_brief") or None
  ```
- If `analysis_brief` is empty, fall back to `build_niche_context_block()` from Source A
- Pass as `niche_context` to `_execute_reel_analyze_url_core()`

**In `run_reel_analyze_bulk()` (bulk path):**
- Fetch client data ONCE before the URL loop (same query as above)
- Pass the same `niche_context` to every iteration

**In `_execute_reel_analyze_url_core()`:**
- Add `niche_context: Optional[str] = None` parameter
- Pass it to `build_reel_analysis_prompt(niche_context=niche_context)`

### Step 7: UI — show briefs in context editor

On the `/context` page, below the existing 6 sections, add a "Client DNA" panel:

- Read-only by default, showing the 3 briefs as collapsible text blocks
- Each brief shows: the text, `compiled_at` timestamp, model used
- "Regenerate" button that calls `POST /clients/{slug}/dna/regenerate`
- Optional: "Edit" toggle that makes a brief editable. If user edits and saves,
  mark it `source: "manual"` so auto-regeneration doesn't overwrite it.
- If no briefs exist yet, show a prompt: "Save your context sections above, then
  briefs will be generated automatically."

---

## Important constraints

- Do NOT change the DB schema for `reel_analyses` — no new score columns
- Do NOT change the 5 existing score column mappings (instant_hook_score, etc.)
- The compaction LLM call uses `settings.openrouter_model` (fast model, same as
  competitor discovery and auto-profile)
- If `compile_client_dna()` fails, log the error but don't block — the analysis
  prompt has a fallback for missing niche context
- The `build_niche_context_block()` function in `reel_analyze_prompt.py` stays as-is —
  it's the fallback when DNA briefs don't exist

## Source hash details

```python
import hashlib, json

def _compute_source_hash(client_row: dict) -> str:
    nc = client_row.get("niche_config") or []
    icp = client_row.get("icp") or {}
    cc = client_row.get("client_context") or {}
    # Extract text content only — ignore metadata (updated_at, source, file)
    cc_texts = {}
    for key, val in cc.items():
        if isinstance(val, dict):
            cc_texts[key] = val.get("text", "")
        elif isinstance(val, str):
            cc_texts[key] = val
    blob = json.dumps(
        {"niche_config": nc, "icp": icp, "context_texts": cc_texts},
        sort_keys=True,
    )
    return hashlib.sha256(blob.encode()).hexdigest()[:16]
```

## Manual brief edit behavior

If a user manually edits a brief:
- Store the edit directly in `client_dna.analysis_brief` (or whichever brief)
- Set `client_dna.analysis_brief_source: "manual"` (or similar flag)
- On next auto-recompilation, check the flag:
  - If `"manual"` → skip that brief, keep the user's version
  - If `"auto"` or missing → overwrite with fresh LLM output
- The "Regenerate" button always overwrites all briefs (resets to auto)

## What this does NOT cover (separate tasks)

- **v2 parser enrichment**: wiring `weighted_total`, `weighted_scores`, `raw_scores`
  into `full_analysis_json` and `result_body`. That's a parser/upsert change, not a
  DNA change. Do it separately.
- **Frontend display of v2 scores**: showing /100 scale, 7 criteria in the analysis
  modal. Separate UI task.
- **Generation pipeline**: actually using `generation_brief` and `voice_brief` in
  hook/script generation. Those pipelines don't exist yet. DNA just prepares the
  briefs so they're ready when those pipelines are built.
