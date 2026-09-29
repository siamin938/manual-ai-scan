-- Citation Page Entity Verification v0.1
--
-- Purpose:
--   Persist page-level evidence answering one narrow question:
--   "Does this cited page itself concern the currently measured target business?"
--
-- This table is advisory and MUST NOT change visibility, Top3, targetSeen,
-- competitor truth, or strict citation attribution. Rows are versioned and
-- append-only. Customer UI may surface confirmed rows as "내 업체 관련성이 확인된 출처".

CREATE TABLE IF NOT EXISTS public.citation_page_entity_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE RESTRICT,
  source_run_id uuid NOT NULL REFERENCES public.measurement_runs(id) ON DELETE RESTRICT,
  measurement_id uuid NOT NULL REFERENCES public.measurements(id) ON DELETE RESTRICT,
  citation_id uuid NOT NULL REFERENCES public.measurement_citations(id) ON DELETE RESTRICT,
  citation_url text NOT NULL CHECK (btrim(citation_url) <> ''),
  canonical_url text NOT NULL CHECK (btrim(canonical_url) <> ''),
  domain text,
  citation_title text,
  page_title text,
  verification_status text NOT NULL
    CHECK (verification_status IN ('confirmed','unresolved','unrelated')),
  confidence text NOT NULL
    CHECK (confidence IN ('high','medium','low')),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(evidence) = 'object'),
  verifier_version text NOT NULL CHECK (btrim(verifier_version) <> ''),
  http_status integer,
  fetch_status text NOT NULL CHECK (btrim(fetch_status) <> ''),
  content_hash text CHECK (
    content_hash IS NULL OR content_hash ~ '^[0-9a-f]{64}$'
  ),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS citation_page_entity_verifications_version_uq
  ON public.citation_page_entity_verifications (
    org_id,
    business_id,
    source_run_id,
    citation_id,
    verifier_version
  );

CREATE INDEX IF NOT EXISTS citation_page_entity_verifications_run_status_idx
  ON public.citation_page_entity_verifications (
    org_id,
    business_id,
    source_run_id,
    verifier_version,
    verification_status,
    created_at DESC
  );

CREATE INDEX IF NOT EXISTS citation_page_entity_verifications_measurement_idx
  ON public.citation_page_entity_verifications (
    measurement_id,
    verification_status
  );

CREATE OR REPLACE FUNCTION public.reject_citation_page_entity_verification_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
BEGIN
  RAISE EXCEPTION 'CITATION_PAGE_ENTITY_VERIFICATION_IMMUTABLE';
END;
$function$;

DROP TRIGGER IF EXISTS citation_page_entity_verifications_immutable
  ON public.citation_page_entity_verifications;
CREATE TRIGGER citation_page_entity_verifications_immutable
BEFORE UPDATE OR DELETE ON public.citation_page_entity_verifications
FOR EACH ROW
EXECUTE FUNCTION public.reject_citation_page_entity_verification_mutation();

ALTER TABLE public.citation_page_entity_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.citation_page_entity_verifications FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.citation_page_entity_verifications FROM PUBLIC;
REVOKE ALL ON TABLE public.citation_page_entity_verifications FROM anon, authenticated;

GRANT SELECT, INSERT ON TABLE public.citation_page_entity_verifications TO service_role;
REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.citation_page_entity_verifications FROM service_role;

REVOKE ALL ON FUNCTION public.reject_citation_page_entity_verification_mutation()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reject_citation_page_entity_verification_mutation()
  TO service_role;

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
  v_verifier_version constant text := '0.1.0';
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

DROP TRIGGER IF EXISTS trg_citation_page_entity_verification_after_v2
  ON public.system_events;

CREATE TRIGGER trg_citation_page_entity_verification_after_v2
AFTER INSERT ON public.system_events
FOR EACH ROW
WHEN (
  NEW.event_type IN (
    'entity_facts_v2_materialization_completed',
    'entity_facts_v2_materialization_refreshed'
  )
)
EXECUTE FUNCTION public.trigger_citation_page_entity_verification_after_v2();

REVOKE ALL ON FUNCTION public.trigger_citation_page_entity_verification_after_v2()
  FROM PUBLIC, anon, authenticated;
