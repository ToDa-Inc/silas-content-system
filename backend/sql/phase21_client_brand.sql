-- Phase 21: Per-client brand defaults for VideoSpec.
-- Run in Supabase SQL Editor.

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS brand_theme jsonb DEFAULT '{}'::jsonb;

COMMENT ON COLUMN clients.brand_theme IS
  'Optional { primary, accent?, defaultThemeId? } for video_spec defaults.';
