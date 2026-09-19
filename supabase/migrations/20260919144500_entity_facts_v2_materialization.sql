-- Phase 2D draft: immutable materialization storage for Measurement Entity Facts v2.
-- IMPORTANT: this migration is repository-only until Production DDL is explicitly approved.
--
-- Authority:
--   measurement_entity_facts_v2 = immutable measurement-level derived truth.
-- Cache/commit marker:
--   run_entity_fact_aggregates_v2 = immutable run aggregate built only after a complete
--   measurement materialization exists.
--
-- Raw parser/provider rows are not modified by this migration.

CREATE TABLE IF NOT EXISTS public.measurement_entity_facts_v2 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  materialization_id uuid NOT NULL,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE RESTRICT,
  source_run_id uuid NOT NULL REFERENCES public.measurement_runs(id) ON DELETE RESTRICT,
  measurement_id uuid NOT NULL REFERENCES public.measurements(id) ON DELETE RESTRICT,
  fact_version text NOT NULL CHECK (btrim(fact_version) <> ''),
  engine_version text NOT NULL CHECK (btrim(engine_version) <> ''),
  input_fingerprint text NOT NULL
    CHECK (input_fingerprint ~ '^[0-9a-f]{64}$'),
  facts jsonb NOT NULL
    CHECK (jsonb_typeof(facts) = 'object'),
  facts_hash text NOT NULL
    CHECK (facts_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT measurement_entity_facts_v2_json_contract_check CHECK (
    facts ? 'version'
    AND facts->>'version' = fact_version
    AND facts ? 'measurementId'
    AND facts->>'measurementId' = measurement_id::text
    AND facts ? 'valid'
    AND jsonb_typeof(facts->'valid') = 'boolean'
    AND facts ? 'targetSeen'
    AND (
      facts->'targetSeen' = 'null'::jsonb
      OR jsonb_typeof(facts->'targetSeen') = 'boolean'
    )
    AND facts ? 'targetBestPosition'
    AND (
      facts->'targetBestPosition' = 'null'::jsonb
      OR (
        jsonb_typeof(facts->'targetBestPosition') = 'number'
        AND (facts->>'targetBestPosition')::integer >= 1
      )
    )
    AND jsonb_typeof(facts->'confirmedOtherEntities') = 'array'
    AND jsonb_typeof(facts->'entityRelations') = 'array'
    AND jsonb_typeof(facts->'targetCitationDomains') = 'array'
    AND jsonb_typeof(facts->'targetAttributionLinks') = 'array'
    AND facts->>'sourceFactsStatus' IN ('complete', 'partial')
    AND jsonb_typeof(facts->'unresolvedIdentityCount') = 'number'
    AND (facts->>'unresolvedIdentityCount')::integer >= 0
    AND jsonb_typeof(facts->'unresolvedTargetCandidateCount') = 'number'
    AND (facts->>'unresolvedTargetCandidateCount')::integer >= 0
    AND jsonb_typeof(facts->'dataQualityFlags') = 'array'
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS measurement_entity_facts_v2_materialization_measurement_uq
  ON public.measurement_entity_facts_v2 (materialization_id, measurement_id);

CREATE INDEX IF NOT EXISTS measurement_entity_facts_v2_run_lookup_idx
  ON public.measurement_entity_facts_v2
  (org_id, business_id, source_run_id, fact_version, engine_version, created_at DESC);

CREATE INDEX IF NOT EXISTS measurement_entity_facts_v2_measurement_lookup_idx
  ON public.measurement_entity_facts_v2
  (measurement_id, fact_version, engine_version, created_at DESC);


CREATE TABLE IF NOT EXISTS public.run_entity_fact_aggregates_v2 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  materialization_id uuid NOT NULL,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE RESTRICT,
  source_run_id uuid NOT NULL REFERENCES public.measurement_runs(id) ON DELETE RESTRICT,
  fact_version text NOT NULL CHECK (btrim(fact_version) <> ''),
  aggregate_version text NOT NULL CHECK (btrim(aggregate_version) <> ''),
  engine_version text NOT NULL CHECK (btrim(engine_version) <> ''),
  input_fingerprint text NOT NULL
    CHECK (input_fingerprint ~ '^[0-9a-f]{64}$'),
  measurement_count integer NOT NULL CHECK (measurement_count >= 0),
  valid_measurement_count integer NOT NULL
    CHECK (
      valid_measurement_count >= 0
      AND valid_measurement_count <= measurement_count
    ),
  contract_ok boolean NOT NULL CHECK (contract_ok = true),
  aggregate jsonb NOT NULL
    CHECK (jsonb_typeof(aggregate) = 'object'),
  aggregate_hash text NOT NULL
    CHECK (aggregate_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT run_entity_fact_aggregates_v2_json_contract_check CHECK (
    aggregate ? 'version'
    AND aggregate->>'version' = aggregate_version
    AND aggregate ? 'factsVersion'
    AND aggregate->>'factsVersion' = fact_version
    AND aggregate ? 'contractOk'
    AND jsonb_typeof(aggregate->'contractOk') = 'boolean'
    AND (aggregate->>'contractOk')::boolean = contract_ok
    AND jsonb_typeof(aggregate->'contractIssues') = 'array'
    AND jsonb_array_length(aggregate->'contractIssues') = 0
    AND jsonb_typeof(aggregate->'overview') = 'object'
    AND (aggregate->'overview') ? 'measurementCount'
    AND (aggregate #>> '{overview,measurementCount}')::integer = measurement_count
    AND (aggregate->'overview') ? 'validCount'
    AND (aggregate #>> '{overview,validCount}')::integer = valid_measurement_count
    AND jsonb_typeof(aggregate->'questionGroups') = 'array'
    AND jsonb_typeof(aggregate->'questionAreas') = 'array'
    AND jsonb_typeof(aggregate->'competitors') = 'array'
    AND jsonb_typeof(aggregate->'targetSources') = 'array'
    AND jsonb_typeof(aggregate->'qualityFlagCounts') = 'object'
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS run_entity_fact_aggregates_v2_materialization_uq
  ON public.run_entity_fact_aggregates_v2 (materialization_id);

CREATE INDEX IF NOT EXISTS run_entity_fact_aggregates_v2_run_lookup_idx
  ON public.run_entity_fact_aggregates_v2
  (org_id, business_id, source_run_id, fact_version, aggregate_version, engine_version, created_at DESC);


CREATE OR REPLACE FUNCTION public.validate_measurement_entity_facts_v2_scope()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_run_org_id uuid;
  v_run_business_id uuid;
  v_measurement_org_id uuid;
  v_measurement_run_id uuid;
BEGIN
  SELECT r.org_id, r.business_id
    INTO v_run_org_id, v_run_business_id
  FROM public.measurement_runs r
  WHERE r.id = NEW.source_run_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ENTITY_FACT_RUN_NOT_FOUND';
  END IF;

  IF v_run_org_id <> NEW.org_id OR v_run_business_id <> NEW.business_id THEN
    RAISE EXCEPTION 'ENTITY_FACT_RUN_SCOPE_MISMATCH';
  END IF;

  SELECT m.org_id, m.run_id
    INTO v_measurement_org_id, v_measurement_run_id
  FROM public.measurements m
  WHERE m.id = NEW.measurement_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ENTITY_FACT_MEASUREMENT_NOT_FOUND';
  END IF;

  IF v_measurement_org_id <> NEW.org_id OR v_measurement_run_id <> NEW.source_run_id THEN
    RAISE EXCEPTION 'ENTITY_FACT_MEASUREMENT_SCOPE_MISMATCH';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS measurement_entity_facts_v2_validate_scope
  ON public.measurement_entity_facts_v2;
CREATE TRIGGER measurement_entity_facts_v2_validate_scope
BEFORE INSERT ON public.measurement_entity_facts_v2
FOR EACH ROW
EXECUTE FUNCTION public.validate_measurement_entity_facts_v2_scope();


CREATE OR REPLACE FUNCTION public.validate_run_entity_fact_aggregate_v2_materialization()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_run_org_id uuid;
  v_run_business_id uuid;
  v_run_measurement_count integer;
  v_run_valid_measurement_count integer;
  v_fact_count integer;
BEGIN
  SELECT r.org_id, r.business_id
    INTO v_run_org_id, v_run_business_id
  FROM public.measurement_runs r
  WHERE r.id = NEW.source_run_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ENTITY_FACT_AGGREGATE_RUN_NOT_FOUND';
  END IF;

  IF v_run_org_id <> NEW.org_id OR v_run_business_id <> NEW.business_id THEN
    RAISE EXCEPTION 'ENTITY_FACT_AGGREGATE_RUN_SCOPE_MISMATCH';
  END IF;

  SELECT
    count(*)::integer,
    count(*) FILTER (WHERE m.valid)::integer
    INTO v_run_measurement_count, v_run_valid_measurement_count
  FROM public.measurements m
  WHERE m.org_id = NEW.org_id
    AND m.run_id = NEW.source_run_id;

  IF NEW.measurement_count <> v_run_measurement_count THEN
    RAISE EXCEPTION 'ENTITY_FACT_AGGREGATE_MEASUREMENT_COUNT_MISMATCH';
  END IF;

  IF NEW.valid_measurement_count <> v_run_valid_measurement_count THEN
    RAISE EXCEPTION 'ENTITY_FACT_AGGREGATE_VALID_COUNT_MISMATCH';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.measurement_entity_facts_v2 f
    WHERE f.materialization_id = NEW.materialization_id
      AND (
        f.org_id <> NEW.org_id
        OR f.business_id <> NEW.business_id
        OR f.source_run_id <> NEW.source_run_id
        OR f.fact_version <> NEW.fact_version
        OR f.engine_version <> NEW.engine_version
      )
  ) THEN
    RAISE EXCEPTION 'ENTITY_FACT_MATERIALIZATION_SCOPE_MIXED';
  END IF;

  SELECT count(*)::integer
    INTO v_fact_count
  FROM public.measurement_entity_facts_v2 f
  WHERE f.materialization_id = NEW.materialization_id
    AND f.org_id = NEW.org_id
    AND f.business_id = NEW.business_id
    AND f.source_run_id = NEW.source_run_id
    AND f.fact_version = NEW.fact_version
    AND f.engine_version = NEW.engine_version;

  IF v_fact_count <> v_run_measurement_count THEN
    RAISE EXCEPTION 'ENTITY_FACT_MATERIALIZATION_INCOMPLETE';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS run_entity_fact_aggregates_v2_validate_materialization
  ON public.run_entity_fact_aggregates_v2;
CREATE TRIGGER run_entity_fact_aggregates_v2_validate_materialization
BEFORE INSERT ON public.run_entity_fact_aggregates_v2
FOR EACH ROW
EXECUTE FUNCTION public.validate_run_entity_fact_aggregate_v2_materialization();


CREATE OR REPLACE FUNCTION public.reject_entity_fact_v2_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  RAISE EXCEPTION 'ENTITY_FACT_MATERIALIZATION_IMMUTABLE';
END;
$function$;

DROP TRIGGER IF EXISTS measurement_entity_facts_v2_immutable
  ON public.measurement_entity_facts_v2;
CREATE TRIGGER measurement_entity_facts_v2_immutable
BEFORE UPDATE OR DELETE ON public.measurement_entity_facts_v2
FOR EACH ROW
EXECUTE FUNCTION public.reject_entity_fact_v2_mutation();

DROP TRIGGER IF EXISTS run_entity_fact_aggregates_v2_immutable
  ON public.run_entity_fact_aggregates_v2;
CREATE TRIGGER run_entity_fact_aggregates_v2_immutable
BEFORE UPDATE OR DELETE ON public.run_entity_fact_aggregates_v2
FOR EACH ROW
EXECUTE FUNCTION public.reject_entity_fact_v2_mutation();


ALTER TABLE public.measurement_entity_facts_v2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.measurement_entity_facts_v2 FORCE ROW LEVEL SECURITY;
ALTER TABLE public.run_entity_fact_aggregates_v2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.run_entity_fact_aggregates_v2 FORCE ROW LEVEL SECURITY;

-- No authenticated/anon SELECT policy by design: raw entity/equivalence provenance is
-- server-internal. Customer-facing access must go through the versioned Read Gateway.
REVOKE ALL ON TABLE public.measurement_entity_facts_v2 FROM PUBLIC;
REVOKE ALL ON TABLE public.measurement_entity_facts_v2 FROM anon, authenticated;
REVOKE ALL ON TABLE public.run_entity_fact_aggregates_v2 FROM PUBLIC;
REVOKE ALL ON TABLE public.run_entity_fact_aggregates_v2 FROM anon, authenticated;

-- Materialization is append-only even for the application service role.
GRANT SELECT, INSERT ON TABLE public.measurement_entity_facts_v2 TO service_role;
GRANT SELECT, INSERT ON TABLE public.run_entity_fact_aggregates_v2 TO service_role;

REVOKE ALL ON FUNCTION public.validate_measurement_entity_facts_v2_scope() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.validate_run_entity_fact_aggregate_v2_materialization() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reject_entity_fact_v2_mutation() FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.measurement_entity_facts_v2 IS
  'Immutable measurement-level authoritative derived entity facts. Server-only; raw parser rows remain unchanged.';

COMMENT ON TABLE public.run_entity_fact_aggregates_v2 IS
  'Immutable run-level cache/commit marker derived from one complete measurement_entity_facts_v2 materialization.';
