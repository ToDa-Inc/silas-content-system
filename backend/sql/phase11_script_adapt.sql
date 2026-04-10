-- script_adapt source mode + optional stored English script for audit.

ALTER TABLE generation_sessions
  DROP CONSTRAINT IF EXISTS generation_sessions_source_type_check;

ALTER TABLE generation_sessions
  ADD CONSTRAINT generation_sessions_source_type_check
  CHECK (
    source_type IN (
      'outlier',
      'patterns',
      'manual',
      'format_pick',
      'idea_match',
      'url_adapt',
      'script_adapt'
    )
  );

ALTER TABLE generation_sessions
  ADD COLUMN IF NOT EXISTS source_script text;

COMMENT ON COLUMN generation_sessions.source_script IS
  'Raw English script pasted for script_adapt (optional audit trail).';
