-- Phase 22: persist the user-selected CTA snapshot on each generation session.
-- Run once in Supabase SQL Editor. Earlier sessions stay NULL and fall back to
-- the legacy OFFER_DOCUMENTATION-driven CTA wording in content_generation.

ALTER TABLE generation_sessions
  ADD COLUMN IF NOT EXISTS selected_cta jsonb;

COMMENT ON COLUMN generation_sessions.selected_cta IS
  'Snapshot of the CTA the user picked under the format selector before generation. Schema: { id, label, type, destination, traffic_goal, instructions }. Stored per-session so old sessions remain stable when the client edits its CTA library later.';
