-- Phase 8: Format intelligence for generation — normalized format on analyses + digest cache.
-- Run once in Supabase SQL editor after prior migrations.

-- Canonical format labels used by services/format_classifier.py
ALTER TABLE reel_analyses
  ADD COLUMN IF NOT EXISTS normalized_format text;

CREATE INDEX IF NOT EXISTS idx_reel_analyses_client_normalized_format
  ON reel_analyses (client_id, normalized_format)
  WHERE normalized_format IS NOT NULL;

COMMENT ON COLUMN reel_analyses.normalized_format IS
  'Canonical reel format key (talking_head, text_overlay, …) for format digests.';

CREATE TABLE IF NOT EXISTS format_digests (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id        text NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  format_key       text NOT NULL,
  reel_count       integer NOT NULL DEFAULT 0,
  mature_count     integer NOT NULL DEFAULT 0,
  avg_engagement   double precision,
  avg_save_rate    double precision,
  avg_share_rate   double precision,
  avg_duration_s   integer,
  top_reel_ids     jsonb,
  digest_json      jsonb NOT NULL DEFAULT '{}',
  computed_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, format_key)
);

CREATE INDEX IF NOT EXISTS idx_format_digests_client
  ON format_digests (client_id, computed_at DESC);

COMMENT ON TABLE format_digests IS
  'Pre-computed per-format pattern digests (mature reels only, 7d+ posted_at).';

-- generation_sessions: new source modes + context fields
ALTER TABLE generation_sessions
  DROP CONSTRAINT IF EXISTS generation_sessions_source_type_check;

ALTER TABLE generation_sessions
  ADD CONSTRAINT generation_sessions_source_type_check
  CHECK (
    source_type IN (
      'outlier',
      'patterns',
      'manual',
      'format_pick',
      'idea_match',
      'url_adapt'
    )
  );

ALTER TABLE generation_sessions
  ADD COLUMN IF NOT EXISTS source_format_key text;

ALTER TABLE generation_sessions
  ADD COLUMN IF NOT EXISTS source_url text;

ALTER TABLE generation_sessions
  ADD COLUMN IF NOT EXISTS source_idea text;
