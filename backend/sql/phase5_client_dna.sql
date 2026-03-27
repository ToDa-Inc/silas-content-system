-- Client DNA: pre-compiled briefs for reel analysis, generation, and voice pipelines.
-- Run once in Supabase SQL editor after `clients` exists.

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS client_dna jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN clients.client_dna IS
  'LLM-compressed context briefs. Regenerated when niche_config, icp, or client_context changes.
   Keys: analysis_brief, generation_brief, voice_brief, source_hash, compiled_at, compiled_by.
   See docs/client_dna.md.';
