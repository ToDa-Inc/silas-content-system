-- Phase 13: Client image library — reusable photos (e.g. of the creator) for video
-- backgrounds and reel covers as an alternative to AI-generated images.
--
-- Run once in Supabase SQL Editor.
-- ALSO create the Storage bucket `client_images` in Dashboard
-- (public read on, no RLS — same model as `broll`).

CREATE TABLE IF NOT EXISTS client_images (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     text NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  file_url      text NOT NULL,
  label         text,
  width         integer,
  height        integer,
  created_at    timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_client_images_client
  ON client_images (client_id, created_at DESC);

COMMENT ON TABLE client_images IS
  'Reusable client photos for cover/background composition (alternative to AI image gen).';

-- Extend background_type CHECK to include the new option.
-- We have to drop+recreate the constraint because PostgreSQL does not allow ALTER CHECK in place.
ALTER TABLE generation_sessions
  DROP CONSTRAINT IF EXISTS generation_sessions_background_type_check;

ALTER TABLE generation_sessions
  ADD CONSTRAINT generation_sessions_background_type_check
  CHECK (background_type IS NULL OR background_type IN ('broll', 'generated_image', 'client_image'));

-- Track which client_image was picked (mirror of broll_clip_id pattern).
ALTER TABLE generation_sessions
  ADD COLUMN IF NOT EXISTS client_image_id uuid;

COMMENT ON COLUMN generation_sessions.client_image_id IS
  'When background_type = ''client_image'', references the chosen client_images.id. Loose ref (no FK) so deletes do not cascade-break sessions.';
