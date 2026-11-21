-- Disposable PostgreSQL regression DB only. No network extension or real worker.
BEGIN;
ALTER TABLE public.measurement_jobs ADD COLUMN status text;
CREATE TABLE public.system_events (org_id uuid, run_id uuid, event_type text, created_at timestamptz);
ALTER TABLE cron.job ADD COLUMN command text;
CREATE FUNCTION cron.alter_job(job_id bigint, command text) RETURNS void LANGUAGE sql AS $$
  UPDATE cron.job AS j SET command = $2 WHERE j.jobid = $1;
$$;
CREATE SCHEMA net;
CREATE TEMP TABLE worker_invocations (body text);
CREATE FUNCTION net.http_post(body text) RETURNS bigint LANGUAGE plpgsql VOLATILE AS $$
BEGIN
  INSERT INTO worker_invocations VALUES (body);
  RETURN 1;
END;
$$;
-- An unscheduled installation must remain unscheduled.
\i :migration
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname='ai-visibility-process-measurement-jobs') THEN
    RAISE EXCEPTION 'migration scheduled an absent job';
  END IF;
END $$;

INSERT INTO cron.job (jobid, jobname, active, command) VALUES
  (517, 'ai-visibility-process-measurement-jobs', true,
   E'\n SELECT net.http_post(body := ''unchanged payload'');\n');
\i :migration
CREATE TEMP TABLE installed_command AS SELECT command FROM cron.job WHERE jobid=517;
\i :migration
DO $test$
DECLARE
  worker_sql text;
  state text;
  expected_calls integer := 0;
BEGIN
  SELECT command INTO STRICT worker_sql FROM cron.job WHERE jobid=517 AND active;
  IF worker_sql IS DISTINCT FROM (SELECT command FROM installed_command)
     OR to_regclass('public.system_events_org_run_type_created_idx') IS NULL THEN
    RAISE EXCEPTION 'guard nesting or missing event index';
  END IF;
  -- Existing retention fixtures have NULL here. Exercise all real queue states.
  EXECUTE worker_sql;
  IF EXISTS (SELECT 1 FROM worker_invocations) THEN RAISE EXCEPTION 'idle worker invoked'; END IF;
  FOREACH state IN ARRAY ARRAY['completed', 'failed', 'cancelled', 'queued', 'processing'] LOOP
    INSERT INTO public.measurement_jobs(id, status) VALUES ('00000000-0000-4000-8000-000000000517', state);
    EXECUTE worker_sql;
    IF state IN ('queued','processing') THEN expected_calls := expected_calls + 1; END IF;
    IF (SELECT count(*) FROM worker_invocations) <> expected_calls THEN
      RAISE EXCEPTION 'wrong invocation count for state %', state;
    END IF;
    DELETE FROM public.measurement_jobs WHERE id='00000000-0000-4000-8000-000000000517';
  END LOOP;
  IF EXISTS (SELECT 1 FROM worker_invocations WHERE body IS DISTINCT FROM 'unchanged payload') THEN
    RAISE EXCEPTION 'original worker request changed';
  END IF;
END;
$test$;
ROLLBACK;
