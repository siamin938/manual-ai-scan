-- Update Citation Page Entity Verification trigger metadata to verifier v0.1.1.
-- The table remains append-only; v0.1.0 rows are preserved.

CREATE OR REPLACE FUNCTION public.trigger_citation_page_entity_verification_after_v2()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_token text;
  v_project_url text;
  v_request_id bigint;
  v_verifier_version constant text := '0.1.1';
BEGIN
  IF NEW.event_type NOT IN (
    'entity_facts_v2_materialization_completed',
    'entity_facts_v2_materialization_refreshed'
  ) THEN
    RETURN NEW;
  END IF;

  IF NEW.run_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT token INTO v_token
  FROM public.visibility_postprocess_tokens
  WHERE active = true
  ORDER BY created_at ASC
  LIMIT 1;

  SELECT decrypted_secret INTO v_project_url
  FROM vault.decrypted_secrets
  WHERE name = 'ai_visibility_project_url'
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_token IS NULL OR v_project_url IS NULL THEN
    INSERT INTO public.system_events(
      org_id, run_id, event_type, severity, message, metadata
    ) VALUES (
      NEW.org_id,
      NEW.run_id,
      'citation_page_entity_verification_trigger_failed',
      'error',
      'Citation page entity verification trigger prerequisites unavailable.',
      jsonb_build_object(
        'verifier_version', v_verifier_version,
        'error_code', 'TRIGGER_CONFIG_UNAVAILABLE'
      )
    );
    RETURN NEW;
  END IF;

  SELECT net.http_post(
    url := rtrim(v_project_url, '/') || '/functions/v1/citation-page-entity-verification',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-visibility-postprocess-token', v_token
    ),
    body := jsonb_build_object('runId', NEW.run_id::text),
    timeout_milliseconds := 120000
  ) INTO v_request_id;

  INSERT INTO public.system_events(
    org_id, run_id, event_type, severity, message, metadata
  ) VALUES (
    NEW.org_id,
    NEW.run_id,
    'citation_page_entity_verification_triggered',
    'info',
    'Citation page entity verification queued after Entity Facts v2 materialization.',
    jsonb_build_object(
      'verifier_version', v_verifier_version,
      'request_id', v_request_id,
      'trigger_event', NEW.event_type
    )
  );

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.trigger_citation_page_entity_verification_after_v2()
  FROM PUBLIC, anon, authenticated;
