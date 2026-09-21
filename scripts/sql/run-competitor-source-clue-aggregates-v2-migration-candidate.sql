-- CANDIDATE ONLY — do not apply directly to Production.
-- Purpose:
--   Preserve advisory competitor source clues separately from the immutable
--   confirmed observed-source supplement.
--
-- Important:
--   - This table never changes targetSources, visibility, Top3 or competitor truth.
--   - Clues are competitor-only and advisory.
--   - One clue is a strict singleton near-section/title-match relationship.
--   - A clue may not duplicate an already accepted entity+domain relationship.

CREATE TABLE IF NOT EXISTS public.run_competitor_source_clue_aggregates_v2 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  base_aggregate_id uuid NOT NULL
    REFERENCES public.run_entity_fact_aggregates_v2(id) ON DELETE RESTRICT,
  base_observed_source_aggregate_id uuid NOT NULL
    REFERENCES public.run_observed_source_aggregates_v2(id) ON DELETE RESTRICT,
  base_materialization_id uuid NOT NULL,
  org_id uuid NOT NULL
    REFERENCES public.organizations(id) ON DELETE RESTRICT,
  business_id uuid NOT NULL
    REFERENCES public.businesses(id) ON DELETE RESTRICT,
  source_run_id uuid NOT NULL
    REFERENCES public.measurement_runs(id) ON DELETE RESTRICT,
  clue_version text NOT NULL
    CHECK (btrim(clue_version) <> ''),
  source_replay_version text NOT NULL
    CHECK (btrim(source_replay_version) <> ''),
  engine_version text NOT NULL
    CHECK (btrim(engine_version) <> ''),
  input_fingerprint text NOT NULL
    CHECK (input_fingerprint ~ '^[0-9a-f]{64}$'),
  source_clues jsonb NOT NULL
    CHECK (jsonb_typeof(source_clues) = 'array'),
  source_clues_hash text NOT NULL
    CHECK (source_clues_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS run_competitor_source_clue_aggregates_v2_base_version_uq
  ON public.run_competitor_source_clue_aggregates_v2 (
    base_aggregate_id,
    base_observed_source_aggregate_id,
    clue_version,
    source_replay_version,
    engine_version
  );

CREATE INDEX IF NOT EXISTS run_competitor_source_clue_aggregates_v2_run_lookup_idx
  ON public.run_competitor_source_clue_aggregates_v2 (
    org_id,
    business_id,
    source_run_id,
    clue_version,
    engine_version,
    created_at DESC
  );

CREATE OR REPLACE FUNCTION public.validate_run_competitor_source_clue_aggregate_v2()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
  v_base public.run_entity_fact_aggregates_v2%ROWTYPE;
  v_observed public.run_observed_source_aggregates_v2%ROWTYPE;
  v_competitor_keys text[];
  v_clue jsonb;
  v_domain text;
  v_canonical_key text;
  v_response_count integer;
  v_attribution_count integer;
  v_evidence_tier text;
BEGIN
  SELECT *
    INTO v_base
  FROM public.run_entity_fact_aggregates_v2
  WHERE id = NEW.base_aggregate_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'COMPETITOR_SOURCE_CLUE_BASE_AGGREGATE_NOT_FOUND';
  END IF;

  IF v_base.contract_ok IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'COMPETITOR_SOURCE_CLUE_BASE_AGGREGATE_NOT_CONTRACT_OK';
  END IF;

  SELECT *
    INTO v_observed
  FROM public.run_observed_source_aggregates_v2
  WHERE id = NEW.base_observed_source_aggregate_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'COMPETITOR_SOURCE_CLUE_OBSERVED_BASE_NOT_FOUND';
  END IF;

  IF
    NEW.base_materialization_id <> v_base.materialization_id
    OR NEW.org_id <> v_base.org_id
    OR NEW.business_id <> v_base.business_id
    OR NEW.source_run_id <> v_base.source_run_id
  THEN
    RAISE EXCEPTION 'COMPETITOR_SOURCE_CLUE_BASE_SCOPE_MISMATCH';
  END IF;

  IF
    v_observed.base_aggregate_id <> v_base.id
    OR v_observed.base_materialization_id <> v_base.materialization_id
    OR v_observed.org_id <> v_base.org_id
    OR v_observed.business_id <> v_base.business_id
    OR v_observed.source_run_id <> v_base.source_run_id
  THEN
    RAISE EXCEPTION 'COMPETITOR_SOURCE_CLUE_OBSERVED_SCOPE_MISMATCH';
  END IF;

  IF
    v_observed.observed_sources_version <> '0.1'
    OR v_observed.source_replay_version <> '0.1'
    OR v_observed.engine_version <>
      'observed-sources-v2:src0.1:obs0.1:store0.1'
  THEN
    RAISE EXCEPTION 'COMPETITOR_SOURCE_CLUE_OBSERVED_BASE_VERSION_MISMATCH';
  END IF;

  SELECT COALESCE(
    array_agg(DISTINCT item->>'canonicalKey' ORDER BY item->>'canonicalKey'),
    ARRAY[]::text[]
  )
  INTO v_competitor_keys
  FROM jsonb_array_elements(v_base.aggregate->'competitors') AS item;

  IF (
    SELECT count(*)
    FROM (
      SELECT
        lower(regexp_replace(item->>'domain', '^www\\.', '')) AS domain,
        item->>'canonicalKey' AS canonical_key
      FROM jsonb_array_elements(NEW.source_clues) AS item
      GROUP BY
        lower(regexp_replace(item->>'domain', '^www\\.', '')),
        item->>'canonicalKey'
      HAVING count(*) > 1
    ) duplicate_pairs
  ) > 0 THEN
    RAISE EXCEPTION 'COMPETITOR_SOURCE_CLUE_DUPLICATE_PAIR';
  END IF;

  FOR v_clue IN
    SELECT value
    FROM jsonb_array_elements(NEW.source_clues)
  LOOP
    v_domain := lower(regexp_replace(v_clue->>'domain', '^www\\.', ''));
    v_canonical_key := btrim(v_clue->>'canonicalKey');
    v_evidence_tier := v_clue->>'evidenceTier';

    IF
      v_domain IS NULL
      OR btrim(v_domain) = ''
      OR v_canonical_key IS NULL
      OR v_canonical_key = ''
      OR v_canonical_key NOT LIKE 'auto:%'
      OR v_evidence_tier IS DISTINCT FROM 'near_section_title_match'
      OR jsonb_typeof(v_clue->'responseCount') IS DISTINCT FROM 'number'
      OR jsonb_typeof(v_clue->'attributionCount') IS DISTINCT FROM 'number'
    THEN
      RAISE EXCEPTION 'COMPETITOR_SOURCE_CLUE_JSON_CONTRACT_INVALID:%', v_domain;
    END IF;

    v_response_count := (v_clue->>'responseCount')::integer;
    v_attribution_count := (v_clue->>'attributionCount')::integer;

    IF
      v_response_count <> 1
      OR v_attribution_count <= 0
    THEN
      RAISE EXCEPTION 'COMPETITOR_SOURCE_CLUE_COUNT_INVALID:%', v_domain;
    END IF;

    IF NOT (v_canonical_key = ANY(v_competitor_keys)) THEN
      RAISE EXCEPTION 'COMPETITOR_SOURCE_CLUE_NOT_IN_BASE_COMPETITORS:%', v_domain;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM jsonb_array_elements(v_observed.observed_sources) AS source
      CROSS JOIN LATERAL jsonb_array_elements(source->'entities') AS entity
      WHERE lower(regexp_replace(source->>'domain', '^www\\.', '')) = v_domain
        AND entity->>'canonicalKey' = v_canonical_key
    ) THEN
      RAISE EXCEPTION 'COMPETITOR_SOURCE_CLUE_ALREADY_ACCEPTED:%', v_domain;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS run_competitor_source_clue_aggregates_v2_validate
  ON public.run_competitor_source_clue_aggregates_v2;
CREATE TRIGGER run_competitor_source_clue_aggregates_v2_validate
BEFORE INSERT ON public.run_competitor_source_clue_aggregates_v2
FOR EACH ROW
EXECUTE FUNCTION public.validate_run_competitor_source_clue_aggregate_v2();

DROP TRIGGER IF EXISTS run_competitor_source_clue_aggregates_v2_immutable
  ON public.run_competitor_source_clue_aggregates_v2;
CREATE TRIGGER run_competitor_source_clue_aggregates_v2_immutable
BEFORE UPDATE OR DELETE ON public.run_competitor_source_clue_aggregates_v2
FOR EACH ROW
EXECUTE FUNCTION public.reject_entity_fact_v2_mutation();

ALTER TABLE public.run_competitor_source_clue_aggregates_v2
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.run_competitor_source_clue_aggregates_v2
  FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.run_competitor_source_clue_aggregates_v2 FROM PUBLIC;
REVOKE ALL ON TABLE public.run_competitor_source_clue_aggregates_v2
  FROM anon, authenticated;

GRANT SELECT, INSERT
  ON TABLE public.run_competitor_source_clue_aggregates_v2
  TO service_role;

REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.run_competitor_source_clue_aggregates_v2
  FROM service_role;

REVOKE ALL
  ON FUNCTION public.validate_run_competitor_source_clue_aggregate_v2()
  FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.run_competitor_source_clue_aggregates_v2 IS
  'Append-only advisory competitor source clues linked to one immutable observed-source supplement. Clues never redefine target or confirmed source truth.';
