-- Client brain: ICP, BrandMap, StoryBoard, Communication Guideline, Offer Documentation, transcript.
-- Run once in Supabase SQL editor after `clients` exists.

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS client_context jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN clients.client_context IS
  'Structured client brain for generation: icp, brand_map, story_board, communication_guideline, offer_documentation, onboarding_transcript.';

-- Private bucket for PDF/DOCX uploads (backend uses service role; no public read).
-- Optional: in Dashboard → Storage, set a 10 MB limit and restrict MIME types to PDF/DOCX.
INSERT INTO storage.buckets (id, name, public)
VALUES ('client-context', 'client-context', false)
ON CONFLICT (id) DO NOTHING;
