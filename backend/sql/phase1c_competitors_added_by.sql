-- Run once on Supabase SQL editor (additive migration).
-- Competitors: who added manually (null = found by automated discovery).

ALTER TABLE competitors
  ADD COLUMN IF NOT EXISTS added_by text;

COMMENT ON COLUMN competitors.added_by IS 'Free text when a human added this competitor via UI; NULL when discovered by system.';
