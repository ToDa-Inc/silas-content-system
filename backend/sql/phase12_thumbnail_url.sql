-- Phase 12: persist thumbnail_url on generation_sessions.
-- Run once in Supabase SQL editor.

ALTER TABLE generation_sessions
  ADD COLUMN IF NOT EXISTS thumbnail_url text;
