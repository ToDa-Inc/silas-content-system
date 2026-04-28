-- Phase 24: Cover/thumbnail templates
--
-- Stores the selected cover/thumbnail template snapshot on generation sessions.
-- The editable template library lives under clients.client_context.cover_thumbnail_templates.

ALTER TABLE generation_sessions
  ADD COLUMN IF NOT EXISTS selected_cover_template jsonb;

COMMENT ON COLUMN generation_sessions.selected_cover_template IS
  'Snapshot of the cover/thumbnail template selected before generation. Shape: '
  '{"id": string, "name": string, "reference_image_id": string, '
  '"reference_image_url": string|null, "reference_label": string|null, '
  '"instruction": string}';
