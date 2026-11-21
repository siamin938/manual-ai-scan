-- A short lock timeout lets an active write take priority during installation.
SET LOCAL lock_timeout = '2s';

CREATE INDEX IF NOT EXISTS system_events_org_run_type_created_idx
  ON public.system_events (org_id, run_id, event_type, created_at DESC);

DO $migration$
DECLARE
  worker_job_id bigint;
  original_command text;
  guard_marker constant text := '/* chaboim: skip idle measurement polls v1 */';
  guarded_body text;
BEGIN
  BEGIN
    SELECT jobid, command INTO STRICT worker_job_id, original_command
      FROM cron.job WHERE jobname = 'ai-visibility-process-measurement-jobs';
  EXCEPTION WHEN NO_DATA_FOUND THEN
    -- Fresh installations may not have scheduled a worker yet.
    RETURN;
  END;

  IF starts_with(original_command, guard_marker) THEN
    RETURN;
  END IF;

  -- Refuse unexpected commands instead of guarding unrelated maintenance.
  IF original_command !~* '^[[:space:]]*select[[:space:]]+net\.http_post[[:space:]]*\('
     OR original_command !~ '\)[[:space:]]*;[[:space:]]*$'
     OR regexp_count(original_command, ';') <> 1 THEN
    RAISE EXCEPTION 'Unexpected measurement-worker cron command; review before applying';
  END IF;

  -- claim_measurement_jobs owns eligibility, locking, retries, and stale cleanup.
  -- A broad presence check keeps scheduled jobs and exhausted processing jobs eligible
  -- for the regular tick. The original request (including Vault lookups) stays intact.
  guarded_body := format($guard$BEGIN
  IF EXISTS (
    SELECT 1 FROM public.measurement_jobs WHERE status IN ('queued', 'processing')
  ) THEN
    EXECUTE %L;
  END IF;
END;$guard$, original_command);

  PERFORM cron.alter_job(job_id := worker_job_id,
    command := guard_marker || E'\n' || format('DO %L;', guarded_body));
END;
$migration$;
