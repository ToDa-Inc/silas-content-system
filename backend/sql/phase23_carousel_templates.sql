-- Phase 23: Carousel templates
--
-- Stores the selected carousel template snapshot on generation sessions. The
-- editable template library lives under clients.client_context.carousel_templates.

ALTER TABLE generation_sessions
  ADD COLUMN IF NOT EXISTS selected_carousel_template jsonb;

COMMENT ON COLUMN generation_sessions.selected_carousel_template IS
  'Snapshot of the carousel template selected before generation. Shape: '
  '{"id": string, "name": string, "description": string|null, "slides": ['
  '{"idx": int, "role": string, "reference_image_id": string|null, '
  '"reference_image_url": string|null, "reference_label": string|null, '
  '"instruction": string}]}';
