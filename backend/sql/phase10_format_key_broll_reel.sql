-- Align legacy format key with Create / Remotion (b_roll → b_roll_reel).
-- Safe to run once; idempotent if already migrated.

UPDATE generation_sessions
SET source_format_key = 'b_roll_reel', updated_at = now()
WHERE source_format_key = 'b_roll';

-- Optional: merge format_digests only if you do not already have a row for b_roll_reel
-- for the same client (conflicts on unique (client_id, format_key) if both exist).
-- UPDATE format_digests SET format_key = 'b_roll_reel' WHERE format_key = 'b_roll';
