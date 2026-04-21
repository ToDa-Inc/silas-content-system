-- Phase 19: AI-generated cover/headline text options for reel covers.
-- Run once in Supabase SQL editor.
--
-- Today the cover thumbnail just reuses hooks[0] (or the chosen angle title) as the
-- burned-in headline. This column stores 5–8 AI-written cover headlines proposed
-- per session by services.content_generation.run_cover_text_options, so the user
-- picks a real cover-style headline (scroll-stopper, ≤10 words, no emojis) instead
-- of a spoken-line hook re-purposed as a cover.
--
-- Additive migration; safe to re-run. Old sessions keep behaving exactly as before
-- (UI falls back to hook chips when this is null).

ALTER TABLE generation_sessions
  ADD COLUMN IF NOT EXISTS cover_text_options jsonb;

COMMENT ON COLUMN generation_sessions.cover_text_options IS
  'AI-proposed reel cover headlines (≤10 words each, no emojis). Generated after choose-angle and on demand via /regenerate-covers.';
