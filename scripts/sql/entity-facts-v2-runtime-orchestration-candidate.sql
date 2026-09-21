-- CANDIDATE ONLY — do not apply directly to Production.
-- Runtime orchestration for Entity Facts v2 materialization.
--
-- Fast path:
--   visibility_citation_attribution_completed event
--     -> HTTP POST entity-facts-v2-materialize-run
--
-- Recovery path:
--   pg_cron every 2 minutes
--     -> eligible completed standalone audits missing the v2 completion event
--
-- The worker itself is idempotent and the atomic commit RPC holds a per-run
-- advisory transaction lock. This orchestration never calls a paid AI provider.

CREATE OR REPLACE FUNCTION public.trigger_entity_facts_v2_materialization_v01()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, net
AS $function$
DECLARE
  v_run public.measurement_runs%ROWTYPE;
  v_project_url text;
  v_token text;
  v_request_id bigint;
BEGIN
  IF
    NEW.event_type <> 'visibility_citation_attribution_completed'
    OR NEW.metadata->>'attribution_version' <> '0.1.0'
    OR NEW.run_id IS NULL
  THEN
    RETURN NEW;
  END IF;

  SELECT *
    INTO v_run
  FROM public.measurement_runs
  WHERE id=NEW.run_id;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF
    v_run.status <> 'completed'::public.run_status
    OR v_run.run_type <> 'audit'::public.run_type
    OR v_run.phase <> 'standalone'::public.run_phase
    OR v_run.experiment_id IS NOT NULL
  THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.system_events se
    WHERE se.org_id=v_run.org_id
      AND se.run_id=v_run.id
      AND se.event_type='entity_facts_v2_materialization_completed'
      AND se.metadata->>'engine_version'=
        'entity-facts-v2:mef0.3:hist0.1:te0.3:src0.1:agg0.1:mat0.1'
  ) THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.system_events se
    WHERE se.org_id=v_run.org_id
      AND se.run_id=v_run.id
      AND se.event_type IN (
        'entity_facts_v2_materialization_triggered',
        'entity_facts_v2_materialization_retry_triggered'
      )
      AND se.created_at >= now() - interval '3 minutes'
  ) THEN
    RETURN NEW;
  END IF;

  SELECT decrypted_secret
    INTO v_project_url
  FROM vault.decrypted_secrets
  WHERE name='ai_visibility_project_url'
  ORDER BY created_at DESC
  LIMIT 1;

  SELECT token
    INTO v_token
  FROM public.visibility_postprocess_tokens
  WHERE name='default'
    AND active=true
  LIMIT 1;

  IF v_project_url IS NULL OR v_token IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT net.http_post(
    url := v_project_url || '/functions/v1/entity-facts-v2-materialize-run',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-visibility-postprocess-token',v_token
    ),
    body := jsonb_build_object('runId',v_run.id),
    timeout_milliseconds := 120000
  )
  INTO v_request_id;

  INSERT INTO public.system_events(
    org_id,run_id,event_type,severity,message,metadata
  ) VALUES (
    v_run.org_id,
    v_run.id,
    'entity_facts_v2_materialization_triggered',
    'info',
    'Entity Facts v2 materialization triggered after citation attribution.',
    jsonb_build_object(
      'engine_version',
        'entity-facts-v2:mef0.3:hist0.1:te0.3:src0.1:agg0.1:mat0.1',
      'request_id',v_request_id,
      'trigger','citation_attribution_completed'
    )
  );

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS system_events_entity_facts_v2_materialization_trigger
  ON public.system_events;
CREATE TRIGGER system_events_entity_facts_v2_materialization_trigger
AFTER INSERT ON public.system_events
FOR EACH ROW
EXECUTE FUNCTION public.trigger_entity_facts_v2_materialization_v01();

REVOKE ALL
  ON FUNCTION public.trigger_entity_facts_v2_materialization_v01()
  FROM PUBLIC, anon, authenticated;


-- Recovery watchdog candidate.
-- If the fast trigger or HTTP request is lost, retry recent eligible runs.
SELECT cron.schedule(
  'entity-facts-v2-materialization-watchdog-v01',
  '*/2 * * * *',
  $cron$
  WITH cfg AS (
    SELECT
      (
        SELECT decrypted_secret
        FROM vault.decrypted_secrets
        WHERE name='ai_visibility_project_url'
        ORDER BY created_at DESC
        LIMIT 1
      ) AS project_url,
      (
        SELECT token
        FROM public.visibility_postprocess_tokens
        WHERE name='default'
          AND active=true
        LIMIT 1
      ) AS worker_token
  ), eligible AS (
    SELECT r.id,r.org_id
    FROM public.measurement_runs r
    WHERE r.run_type='audit'::public.run_type
      AND r.phase='standalone'::public.run_phase
      AND r.experiment_id IS NULL
      AND r.status='completed'::public.run_status
      AND COALESCE(r.completed_at,r.created_at) >= now() - interval '24 hours'
      AND EXISTS (
        SELECT 1
        FROM public.system_events se
        WHERE se.org_id=r.org_id
          AND se.run_id=r.id
          AND se.event_type='visibility_postprocess_completed'
          AND se.metadata->>'pipeline_version'='0.1.4'
      )
      AND EXISTS (
        SELECT 1
        FROM public.system_events se
        WHERE se.org_id=r.org_id
          AND se.run_id=r.id
          AND se.event_type='visibility_citation_attribution_completed'
          AND se.metadata->>'attribution_version'='0.1.0'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.system_events se
        WHERE se.org_id=r.org_id
          AND se.run_id=r.id
          AND se.event_type='entity_facts_v2_materialization_completed'
          AND se.metadata->>'engine_version'=
            'entity-facts-v2:mef0.3:hist0.1:te0.3:src0.1:agg0.1:mat0.1'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.system_events se
        WHERE se.org_id=r.org_id
          AND se.run_id=r.id
          AND se.event_type IN (
            'entity_facts_v2_materialization_triggered',
            'entity_facts_v2_materialization_retry_triggered'
          )
          AND se.created_at >= now() - interval '3 minutes'
      )
    ORDER BY COALESCE(r.completed_at,r.created_at) ASC
    LIMIT 5
  ), calls AS (
    SELECT
      e.id AS run_id,
      e.org_id,
      net.http_post(
        url := cfg.project_url || '/functions/v1/entity-facts-v2-materialize-run',
        headers := jsonb_build_object(
          'Content-Type','application/json',
          'x-visibility-postprocess-token',cfg.worker_token
        ),
        body := jsonb_build_object('runId',e.id),
        timeout_milliseconds := 120000
      ) AS request_id
    FROM eligible e
    CROSS JOIN cfg
    WHERE cfg.project_url IS NOT NULL
      AND cfg.worker_token IS NOT NULL
  )
  INSERT INTO public.system_events(
    org_id,run_id,event_type,severity,message,metadata
  )
  SELECT
    org_id,
    run_id,
    'entity_facts_v2_materialization_retry_triggered',
    'warning',
    'Entity Facts v2 materialization watchdog retried a ready run.',
    jsonb_build_object(
      'engine_version',
        'entity-facts-v2:mef0.3:hist0.1:te0.3:src0.1:agg0.1:mat0.1',
      'request_id',request_id,
      'watchdog',true
    )
  FROM calls;
  $cron$
);
