-- Run once in Supabase SQL editor.
-- Content generation sessions: patterns → angles → hooks / script / caption / story.

CREATE TABLE IF NOT EXISTS generation_sessions (
  id                    text PRIMARY KEY,
  client_id             text NOT NULL REFERENCES clients(id) ON DELETE CASCADE,

  source_type           text NOT NULL DEFAULT 'patterns'
                        CHECK (source_type IN ('outlier', 'patterns', 'manual')),
  source_analysis_ids   uuid[],
  source_reel_ids       text[],

  synthesized_patterns  jsonb,
  angles                jsonb,
  chosen_angle_index    integer,

  hooks                 jsonb,
  script                text,
  caption_body          text,
  hashtags              jsonb,
  story_variants        jsonb,

  status                text NOT NULL DEFAULT 'angles_ready'
                        CHECK (status IN (
                          'angles_ready',
                          'content_ready',
                          'approved',
                          'rejected'
                        )),
  feedback              text,
  prompt_version        text,

  created_at            timestamptz DEFAULT now(),
  updated_at            timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_generation_sessions_client_created
  ON generation_sessions (client_id, created_at DESC);

COMMENT ON TABLE generation_sessions IS 'Outlier-driven copy generation: angles then full package (hooks, script, caption, stories).';
