-- CANDIDATE ONLY — do not apply directly to Production.
-- When approved, generate the real Supabase migration with the CLI and copy
-- the reviewed SQL into that generated migration file.
--
-- Purpose:
--   Add an append-only run-level supplement for observed source relationships
--   without rewriting measurement_entity_facts_v2 or run_entity_fact_aggregates_v2.
--
-- Base Entity Facts v2 remains authoritative for:
--   - targetSources
--   - competitors
--   - visibility / top3 / question truth
--
-- This supplement preserves only source↔entity observations that already
-- passed source replay and must stay consistent with the referenced base
-- aggregate.

CREATE TABLE IF NOT EXISTS public.run_observed_source_aggregates_v2 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  base_aggregate_id uuid NOT NULL
    REFERENCES public.run_entity_fact_aggregates_v2(id) ON DELETE RESTRICT,
  base_materialization_id uuid NOT NULL,
  org_id uuid NOT NULL
    REFERENCES public.organizations(id) ON DELETE RESTRICT,
  business_id uuid NOT NULL
    REFERENCES public.businesses(id) ON DELETE RESTRICT,
  source_run_id uuid NOT NULL
    REFERENCES public.measurement_runs(id) ON DELETE RESTRICT,
  observed_sources_version text NOT NULL
    CHECK (btrim(observed_sources_version) <> ''),
  source_replay_version text NOT NULL
    CHECK (btrim(source_replay_version) <> ''),
  engine_version text NOT NULL
    CHECK (btrim(engine_version) <> ''),
  input_fingerprint text NOT NULL
    CHECK (input_fingerprint ~ '^[0-9a-f]{64}$'),
  observed_sources jsonb NOT NULL
    CHECK (jsonb_typeof(observed_sources) = 'array'),
  observed_sources_hash text NOT NULL
    CHECK (observed_sources_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS run_observed_source_aggregates_v2_base_version_uq
  ON public.run_observed_source_aggregates_v2 (
    base_aggregate_id,
    observed_sources_version,
    engine_version
  );

CREATE INDEX IF NOT EXISTS run_observed_source_aggregates_v2_run_lookup_idx
  ON public.run_observed_source_aggregates_v2 (
    org_id,
    business_id,
    source_run_id,
    observed_sources_version,
    engine_version,
    created_at DESC
  );

CREATE OR REPLACE FUNCTION public.validate_run_observed_source_aggregate_v2()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
  v_base public.run_entity_fact_aggregates_v2%ROWTYPE;
  v_target_key text;
  v_base_target_domains text[];
  v_observed_target_domains text[];
  v_base_competitor_keys text[];
  v_source jsonb;
  v_entity jsonb;
  v_domain text;
  v_response_count integer;
  v_target_response_count integer;
  v_other_response_count integer;
  v_attribution_count integer;
  v_entity_key text;
  v_entity_side text;
  v_entity_response_count integer;
  v_entity_attribution_count integer;
  v_direct_response_count integer;
  v_near_section_response_count integer;
  v_base_target_response_count integer;
  v_entity_attribution_sum integer;
BEGIN
  SELECT *
    INTO v_base
  FROM public.run_entity_fact_aggregates_v2
  WHERE id = NEW.base_aggregate_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'OBSERVED_SOURCE_BASE_AGGREGATE_NOT_FOUND';
  END IF;

  IF v_base.contract_ok IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'OBSERVED_SOURCE_BASE_AGGREGATE_NOT_CONTRACT_OK';
  END IF;

  IF
    NEW.base_materialization_id <> v_base.materialization_id
    OR NEW.org_id <> v_base.org_id
    OR NEW.business_id <> v_base.business_id
    OR NEW.source_run_id <> v_base.source_run_id
  THEN
    RAISE EXCEPTION 'OBSERVED_SOURCE_BASE_SCOPE_MISMATCH';
  END IF;

  v_target_key := 'business:' || NEW.business_id::text;

  SELECT COALESCE(
    array_agg(DISTINCT lower(regexp_replace(item->>'domain', '^www\\.', ''))
      ORDER BY lower(regexp_replace(item->>'domain', '^www\\.', ''))),
    ARRAY[]::text[]
  )
  INTO v_base_target_domains
  FROM jsonb_array_elements(v_base.aggregate->'targetSources') AS item;

  SELECT COALESCE(
    array_agg(DISTINCT item->>'canonicalKey' ORDER BY item->>'canonicalKey'),
    ARRAY[]::text[]
  )
  INTO v_base_competitor_keys
  FROM jsonb_array_elements(v_base.aggregate->'competitors') AS item;

  IF EXISTS (
    SELECT 1
    FROM (
      SELECT lower(regexp_replace(item->>'domain', '^www\\.', '')) AS domain
      FROM jsonb_array_elements(NEW.observed_sources) AS item
    ) d
    WHERE d.domain IS NULL OR btrim(d.domain) = ''
  ) THEN
    RAISE EXCEPTION 'OBSERVED_SOURCE_DOMAIN_INVALID';
  END IF;

  IF (
    SELECT count(*)
    FROM (
      SELECT lower(regexp_replace(item->>'domain', '^www\\.', '')) AS domain
      FROM jsonb_array_elements(NEW.observed_sources) AS item
      GROUP BY lower(regexp_replace(item->>'domain', '^www\\.', ''))
      HAVING count(*) > 1
    ) duplicate_domains
  ) > 0 THEN
    RAISE EXCEPTION 'OBSERVED_SOURCE_DOMAIN_DUPLICATE';
  END IF;

  FOR v_source IN
    SELECT value
    FROM jsonb_array_elements(NEW.observed_sources)
  LOOP
    v_domain := lower(regexp_replace(v_source->>'domain', '^www\\.', ''));

    IF
      jsonb_typeof(v_source->'responseCount') IS DISTINCT FROM 'number'
      OR jsonb_typeof(v_source->'targetResponseCount') IS DISTINCT FROM 'number'
      OR jsonb_typeof(v_source->'otherResponseCount') IS DISTINCT FROM 'number'
      OR jsonb_typeof(v_source->'attributionCount') IS DISTINCT FROM 'number'
      OR jsonb_typeof(v_source->'entities') IS DISTINCT FROM 'array'
    THEN
      RAISE EXCEPTION 'OBSERVED_SOURCE_JSON_CONTRACT_INVALID:%', v_domain;
    END IF;

    v_response_count := (v_source->>'responseCount')::integer;
    v_target_response_count := (v_source->>'targetResponseCount')::integer;
    v_other_response_count := (v_source->>'otherResponseCount')::integer;
    v_attribution_count := (v_source->>'attributionCount')::integer;

    IF
      v_response_count <= 0
      OR v_target_response_count < 0
      OR v_other_response_count < 0
      OR v_attribution_count <= 0
      OR v_response_count < greatest(
        v_target_response_count,
        v_other_response_count
      )
      OR v_response_count >
        v_target_response_count + v_other_response_count
    THEN
      RAISE EXCEPTION 'OBSERVED_SOURCE_COUNT_INVALID:%', v_domain;
    END IF;

    IF jsonb_array_length(v_source->'entities') = 0 THEN
      RAISE EXCEPTION 'OBSERVED_SOURCE_ENTITY_LIST_EMPTY:%', v_domain;
    END IF;

    IF
      (v_target_response_count > 0) IS DISTINCT FROM EXISTS (
        SELECT 1
        FROM jsonb_array_elements(v_source->'entities') AS entity
        WHERE entity->>'side' = 'target'
      )
      OR
      (v_other_response_count > 0) IS DISTINCT FROM EXISTS (
        SELECT 1
        FROM jsonb_array_elements(v_source->'entities') AS entity
        WHERE entity->>'side' = 'other'
      )
    THEN
      RAISE EXCEPTION 'OBSERVED_SOURCE_SIDE_COUNT_MISMATCH:%', v_domain;
    END IF;

    SELECT COALESCE(
      sum((entity->>'attributionCount')::integer),
      0
    )
    INTO v_entity_attribution_sum
    FROM jsonb_array_elements(v_source->'entities') AS entity
    WHERE jsonb_typeof(entity->'attributionCount') = 'number';

    IF v_entity_attribution_sum <> v_attribution_count THEN
      RAISE EXCEPTION 'OBSERVED_SOURCE_ATTRIBUTION_COUNT_MISMATCH:%', v_domain;
    END IF;

    IF (
      SELECT count(*)
      FROM (
        SELECT item->>'canonicalKey' AS canonical_key
        FROM jsonb_array_elements(v_source->'entities') AS item
        GROUP BY item->>'canonicalKey'
        HAVING count(*) > 1
      ) duplicate_entities
    ) > 0 THEN
      RAISE EXCEPTION 'OBSERVED_SOURCE_ENTITY_DUPLICATE:%', v_domain;
    END IF;

    FOR v_entity IN
      SELECT value
      FROM jsonb_array_elements(v_source->'entities')
    LOOP
      v_entity_key := btrim(v_entity->>'canonicalKey');
      v_entity_side := v_entity->>'side';

      IF
        v_entity_key IS NULL
        OR v_entity_key = ''
        OR v_entity_side IS NULL
        OR v_entity_side NOT IN ('target', 'other')
        OR jsonb_typeof(v_entity->'responseCount') IS DISTINCT FROM 'number'
        OR jsonb_typeof(v_entity->'attributionCount') IS DISTINCT FROM 'number'
        OR jsonb_typeof(v_entity->'directResponseCount') IS DISTINCT FROM 'number'
        OR jsonb_typeof(v_entity->'nearSectionResponseCount') IS DISTINCT FROM 'number'
      THEN
        RAISE EXCEPTION 'OBSERVED_SOURCE_ENTITY_CONTRACT_INVALID:%', v_domain;
      END IF;

      v_entity_response_count := (v_entity->>'responseCount')::integer;
      v_entity_attribution_count := (v_entity->>'attributionCount')::integer;
      v_direct_response_count := (v_entity->>'directResponseCount')::integer;
      v_near_section_response_count :=
        (v_entity->>'nearSectionResponseCount')::integer;

      IF
        v_entity_response_count <= 0
        OR v_entity_attribution_count <= 0
        OR v_direct_response_count < 0
        OR v_near_section_response_count < 0
        OR v_entity_response_count > v_response_count
        OR v_entity_attribution_count > v_attribution_count
        OR v_direct_response_count > v_entity_response_count
        OR v_near_section_response_count > v_entity_response_count
      THEN
        RAISE EXCEPTION 'OBSERVED_SOURCE_ENTITY_COUNT_INVALID:%', v_domain;
      END IF;

      IF v_entity_side = 'target' THEN
        IF v_entity_key <> v_target_key THEN
          RAISE EXCEPTION 'OBSERVED_SOURCE_TARGET_KEY_MISMATCH:%', v_domain;
        END IF;
        IF v_entity_response_count > v_target_response_count THEN
          RAISE EXCEPTION 'OBSERVED_SOURCE_ENTITY_COUNT_INVALID:%', v_domain;
        END IF;
      ELSE
        IF v_entity_response_count > v_other_response_count THEN
          RAISE EXCEPTION 'OBSERVED_SOURCE_ENTITY_COUNT_INVALID:%', v_domain;
        END IF;
        IF NOT (v_entity_key = ANY(v_base_competitor_keys)) THEN
          RAISE EXCEPTION 'OBSERVED_SOURCE_COMPETITOR_NOT_IN_BASE:%', v_domain;
        END IF;
      END IF;
    END LOOP;

    IF v_target_response_count > 0 THEN
      SELECT (item->>'responseCount')::integer
        INTO v_base_target_response_count
      FROM jsonb_array_elements(v_base.aggregate->'targetSources') AS item
      WHERE lower(regexp_replace(item->>'domain', '^www\\.', '')) = v_domain
      LIMIT 1;

      IF
        v_base_target_response_count IS NULL
        OR v_base_target_response_count <> v_target_response_count
      THEN
        RAISE EXCEPTION 'OBSERVED_SOURCE_TARGET_RESPONSE_COUNT_MISMATCH:%', v_domain;
      END IF;
    END IF;
  END LOOP;

  SELECT COALESCE(
    array_agg(domain ORDER BY domain),
    ARRAY[]::text[]
  )
  INTO v_observed_target_domains
  FROM (
    SELECT DISTINCT lower(regexp_replace(source->>'domain', '^www\\.', '')) AS domain
    FROM jsonb_array_elements(NEW.observed_sources) AS source
    WHERE (source->>'targetResponseCount')::integer > 0
  ) target_domains;

  IF v_observed_target_domains IS DISTINCT FROM v_base_target_domains THEN
    RAISE EXCEPTION 'OBSERVED_SOURCE_TARGET_DOMAIN_PARITY_MISMATCH';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS run_observed_source_aggregates_v2_validate
  ON public.run_observed_source_aggregates_v2;
CREATE TRIGGER run_observed_source_aggregates_v2_validate
BEFORE INSERT ON public.run_observed_source_aggregates_v2
FOR EACH ROW
EXECUTE FUNCTION public.validate_run_observed_source_aggregate_v2();

DROP TRIGGER IF EXISTS run_observed_source_aggregates_v2_immutable
  ON public.run_observed_source_aggregates_v2;
CREATE TRIGGER run_observed_source_aggregates_v2_immutable
BEFORE UPDATE OR DELETE ON public.run_observed_source_aggregates_v2
FOR EACH ROW
EXECUTE FUNCTION public.reject_entity_fact_v2_mutation();

ALTER TABLE public.run_observed_source_aggregates_v2
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.run_observed_source_aggregates_v2
  FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.run_observed_source_aggregates_v2 FROM PUBLIC;
REVOKE ALL ON TABLE public.run_observed_source_aggregates_v2
  FROM anon, authenticated;

GRANT SELECT, INSERT
  ON TABLE public.run_observed_source_aggregates_v2
  TO service_role;

REVOKE UPDATE, DELETE, TRUNCATE
  ON TABLE public.run_observed_source_aggregates_v2
  FROM service_role;

REVOKE ALL
  ON FUNCTION public.validate_run_observed_source_aggregate_v2()
  FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.run_observed_source_aggregates_v2 IS
  'Candidate append-only supplement for run-level source/entity observations linked to one immutable Entity Facts v2 aggregate.';
