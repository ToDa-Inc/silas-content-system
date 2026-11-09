-- Phase 33: learning loop — post ↔ reel linking, reel diagnostics, hook/angle votes,
-- per-client learning settings, and a per-generation "learned from" trace.
-- Run once in the Supabase SQL editor. Safe to re-run (IF NOT EXISTS everywhere).

-- 1) Link a generated post to the client's own published reel.
ALTER TABLE generation_sessions
  ADD COLUMN IF NOT EXISTS published_reel_id     text REFERENCES scraped_reels(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS published_link_source text CHECK (published_link_source IN ('auto', 'manual')),
  ADD COLUMN IF NOT EXISTS published_match_score real,
  ADD COLUMN IF NOT EXISTS published_linked_at   timestamptz,
  -- 50–80% caption/hook similarity: shown as "possible match, confirm?" — never applied silently.
  ADD COLUMN IF NOT EXISTS suggested_reel_id     text REFERENCES scraped_reels(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS suggested_match_score real,
  -- What the learning block contained when this post was generated (winners, avoid, votes).
  ADD COLUMN IF NOT EXISTS learning_trace        jsonb;

-- One reel belongs to at most one post.
CREATE UNIQUE INDEX IF NOT EXISTS uq_generation_sessions_published_reel
  ON generation_sessions (published_reel_id)
  WHERE published_reel_id IS NOT NULL;

-- 2) Diagnostic bucket per own reel. Recomputed after each refresh; override always wins.
CREATE TABLE IF NOT EXISTS reel_diagnostics (
  reel_id         text PRIMARY KEY REFERENCES scraped_reels(id) ON DELETE CASCADE,
  client_id       text NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  rule_bucket     text NOT NULL
                  CHECK (rule_bucket IN ('scale', 'adjust_hook', 'adjust_cta', 'retire', 'keep')),
  override_bucket text
                  CHECK (override_bucket IN ('scale', 'adjust_hook', 'adjust_cta', 'retire', 'keep')),
  excluded        boolean NOT NULL DEFAULT false,
  -- Numbers that produced the bucket (views, median, ratios, age) so every verdict is explainable.
  metrics         jsonb NOT NULL DEFAULT '{}'::jsonb,
  reason          text NOT NULL DEFAULT '',
  -- Bucket the auto AI analysis last ran for (avoids re-analysing on every refresh).
  analyzed_bucket text,
  computed_at     timestamptz NOT NULL DEFAULT now(),
  overridden_at   timestamptz
);

CREATE INDEX IF NOT EXISTS idx_reel_diagnostics_client
  ON reel_diagnostics (client_id);

-- 3) Thumbs up / down on hooks and angles.
CREATE TABLE IF NOT EXISTS hook_votes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   text NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  session_id  text REFERENCES generation_sessions(id) ON DELETE SET NULL,
  kind        text NOT NULL CHECK (kind IN ('hook', 'angle')),
  text        text NOT NULL,
  -- Lower-cased, whitespace-collapsed text: one vote per (client, kind, text).
  text_key    text NOT NULL,
  vote        smallint NOT NULL CHECK (vote IN (-1, 1)),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_hook_votes_client_kind_text UNIQUE (client_id, kind, text_key)
);

CREATE INDEX IF NOT EXISTS idx_hook_votes_client_updated
  ON hook_votes (client_id, updated_at DESC);

-- 4) Per-client switch ("Learn from results") and threshold overrides ({} = defaults).
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS learning_enabled    boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS learning_thresholds jsonb   NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON TABLE reel_diagnostics IS 'Learning loop: scale / adjust_hook / adjust_cta / retire / keep per own reel; override_bucket beats rule_bucket.';
COMMENT ON TABLE hook_votes IS 'Learning loop: thumbs up/down on generated hooks and angles.';
