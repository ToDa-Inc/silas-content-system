-- Run once in Supabase SQL editor.
-- If you previously created `client_reel_analyses` (deprecated), drop it first:
--   DROP TABLE IF EXISTS client_reel_analyses;
--
-- Phase 2: Reel analyses — Silas 5-criteria scoring of scraped reels.
-- This is the single analysis table for ALL analysis sources:
--   analyze_url (paste a URL), bulk_outlier (auto after scrape), bulk_own (auto for client reels)
--
-- Stable key: (client_id, post_url) — survives reel row churn on baseline refresh.
-- reel_id is a convenience FK updated when scraped_reels row exists.
--
-- clients.id and scraped_reels.client_id use app-owned text IDs (cli_…, srl_…), not uuid.

CREATE TABLE IF NOT EXISTS reel_analyses (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id               text NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  -- scraped_reels.id uses app-owned text IDs (e.g. srl_…), not uuid
  reel_id                 text REFERENCES scraped_reels(id) ON DELETE SET NULL,
  analysis_job_id         text,
  source                  text NOT NULL DEFAULT 'analyze_url',
  post_url                text NOT NULL,

  -- 5-criteria scoring (docs/CRITERIA.md — each 1–10, total 50)
  instant_hook_score      integer CHECK (instant_hook_score BETWEEN 1 AND 10),
  relatability_score      integer CHECK (relatability_score BETWEEN 1 AND 10),
  cognitive_tension_score integer CHECK (cognitive_tension_score BETWEEN 1 AND 10),
  clear_value_score       integer CHECK (clear_value_score BETWEEN 1 AND 10),
  comment_trigger_score   integer CHECK (comment_trigger_score BETWEEN 1 AND 10),
  total_score             integer GENERATED ALWAYS AS (
    COALESCE(instant_hook_score, 0) +
    COALESCE(relatability_score, 0) +
    COALESCE(cognitive_tension_score, 0) +
    COALESCE(clear_value_score, 0) +
    COALESCE(comment_trigger_score, 0)
  ) STORED,
  replicability_rating    text GENERATED ALWAYS AS (
    CASE
      WHEN (COALESCE(instant_hook_score,0)+COALESCE(relatability_score,0)+COALESCE(cognitive_tension_score,0)+COALESCE(clear_value_score,0)+COALESCE(comment_trigger_score,0)) >= 40 THEN 'highly_replicable'
      WHEN (COALESCE(instant_hook_score,0)+COALESCE(relatability_score,0)+COALESCE(cognitive_tension_score,0)+COALESCE(clear_value_score,0)+COALESCE(comment_trigger_score,0)) >= 30 THEN 'strong_pattern'
      WHEN (COALESCE(instant_hook_score,0)+COALESCE(relatability_score,0)+COALESCE(cognitive_tension_score,0)+COALESCE(clear_value_score,0)+COALESCE(comment_trigger_score,0)) >= 20 THEN 'moderate'
      ELSE 'weak'
    END
  ) STORED,

  -- Qualitative breakdown
  hook_type               text,
  emotional_trigger       text,
  content_angle           text,
  caption_structure       text,
  why_it_worked           text,
  replicable_elements     jsonb,
  suggested_adaptations   jsonb,

  -- Full model output (traceability + UI)
  full_analysis_json      jsonb,

  -- Metadata
  owner_username          text,
  model_used              text,
  prompt_version          text,
  video_analyzed          boolean DEFAULT true,
  analyzed_at             timestamptz DEFAULT now(),
  created_at              timestamptz DEFAULT now(),

  UNIQUE (client_id, post_url)
);

CREATE INDEX IF NOT EXISTS idx_reel_analyses_client_score
  ON reel_analyses (client_id, total_score DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_reel_analyses_reel_id
  ON reel_analyses (reel_id)
  WHERE reel_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_reel_analyses_source
  ON reel_analyses (client_id, source, created_at DESC);

COMMENT ON TABLE reel_analyses IS 'Silas 5-criteria scoring of reels. Stable key = (client_id, post_url). reel_id is a convenience FK to scraped_reels.';
