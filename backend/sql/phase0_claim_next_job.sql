-- Worker queue: atomic claim of the next background job (required for backend/worker.py).
-- Run in Supabase SQL Editor if jobs never get picked (worker stays idle without errors).

CREATE OR REPLACE FUNCTION public.claim_next_job()
RETURNS SETOF public.background_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH next_job AS (
    SELECT id
    FROM public.background_jobs
    WHERE status = 'queued'
    ORDER BY COALESCE(priority, 0) DESC, created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  )
  UPDATE public.background_jobs AS j
  SET
    status = 'running',
    started_at = COALESCE(j.started_at, now())
  FROM next_job AS n
  WHERE j.id = n.id
  RETURNING j.*;
END;
$$;

COMMENT ON FUNCTION public.claim_next_job() IS
  'Claims one queued background_jobs row (SKIP LOCKED). Used by python worker.py.';

GRANT EXECUTE ON FUNCTION public.claim_next_job() TO service_role;
