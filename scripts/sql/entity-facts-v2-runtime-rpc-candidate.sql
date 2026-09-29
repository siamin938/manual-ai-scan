-- CANDIDATE ONLY — do not apply directly to Production.
-- Purpose:
-- 1) expose one read-only runtime context for a completed standalone audit,
-- 2) atomically commit all four immutable v2 layers in one PostgreSQL transaction.
--
-- This file intentionally contains no provider calls and does not alter legacy rows.

CREATE OR REPLACE FUNCTION public.get_entity_facts_v2_runtime_context_v01(
  p_run_id uuid
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
WITH run_scope AS (
  SELECT
    r.id,
    r.org_id,
    r.business_id,
    r.status::text AS status,
    r.run_type::text AS run_type,
    r.phase::text AS phase,
    r.experiment_id
  FROM public.measurement_runs r
  WHERE r.id = p_run_id
), replay_measurements AS (
  SELECT
    m.id AS measurement_id,
    m.org_id,
    m.run_id,
    m.question_id,
    m.response_text,
    m.was_client_mentioned,
    m.client_position,
    m.valid,
    rs.business_id,
    q.prompt_text,
    COALESCE(NULLIF(q.intent_type,''),'other') AS intent_type
  FROM public.measurements m
  JOIN run_scope rs
    ON rs.id=m.run_id
   AND rs.org_id=m.org_id
  LEFT JOIN public.questions q
    ON q.id=m.question_id
   AND q.org_id=m.org_id
), target_context AS (
  SELECT
    rm.measurement_id,
    jsonb_build_object(
      'id', b.id,
      'name', b.name,
      'aliases', COALESCE(b.aliases,'{}'::text[]),
      'fullAddress', b.address,
      'canonicalNaverPlaceId', b.naver_place_url,
      'verifiedPhone', null,
      'verifiedConcreteOfficialUrls', '[]'::jsonb,
      'branchIdentityKey', null
    ) AS target
  FROM replay_measurements rm
  JOIN public.businesses b
    ON b.id=rm.business_id
   AND b.org_id=rm.org_id
), registered_context AS (
  SELECT
    rm.measurement_id,
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id', b.id,
          'name', b.name,
          'aliases', COALESCE(b.aliases,'{}'::text[]),
          'fullAddress', b.address,
          'canonicalNaverPlaceId', b.naver_place_url,
          'verifiedPhone', null,
          'verifiedConcreteOfficialUrls', '[]'::jsonb,
          'branchIdentityKey', null
        )
        ORDER BY b.name,b.id
      ),
      '[]'::jsonb
    ) AS businesses
  FROM replay_measurements rm
  JOIN public.businesses b
    ON b.org_id=rm.org_id
   AND b.active=true
  GROUP BY rm.measurement_id
), mention_context AS (
  SELECT
    rm.measurement_id,
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'mentionId', mm.id,
          'displayName', mm.display_name,
          'matchedAlias', mm.matched_alias,
          'matchedBusinessId', mm.matched_business_id,
          'position', mm.position,
          'canonicalKey', cc.canonical_key,
          'canonicalDisplayName', cc.canonical_display_name
        )
        ORDER BY mm.position NULLS LAST,mm.display_name,mm.id
      ),
      '[]'::jsonb
    ) AS mentions
  FROM replay_measurements rm
  JOIN public.measurement_mentions mm
    ON mm.measurement_id=rm.measurement_id
   AND mm.org_id=rm.org_id
  LEFT JOIN LATERAL (
    SELECT
      c.canonical_key,
      c.canonical_display_name
    FROM public.measurement_entity_canonicalizations c
    WHERE c.measurement_id=rm.measurement_id
      AND c.measurement_mention_id=mm.id
      AND c.org_id=rm.org_id
      AND c.business_id=rm.business_id
    ORDER BY c.created_at DESC,c.id DESC
    LIMIT 1
  ) cc ON true
  GROUP BY rm.measurement_id
), attribution_context AS (
  SELECT
    rm.measurement_id,
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'attributionId', a.id,
          'measurementMentionId', a.measurement_mention_id,
          'canonicalKey', a.canonical_key,
          'domain', a.domain,
          'url', a.citation_url,
          'title', a.title,
          'attributionLevel', a.attribution_level,
          'evidence', a.evidence,
          'citationStartIndex', a.citation_start_index,
          'entityEndIndex', a.entity_end_index
        )
        ORDER BY a.id
      ),
      '[]'::jsonb
    ) AS attributions
  FROM replay_measurements rm
  JOIN public.measurement_citation_attributions a
    ON a.measurement_id=rm.measurement_id
   AND a.org_id=rm.org_id
   AND a.business_id=rm.business_id
   AND a.attribution_version='0.1.0'
  GROUP BY rm.measurement_id
), public_identity_directory AS (
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'name', b.name,
        'aliases', COALESCE(b.aliases,'{}'::text[]),
        'fullAddress', b.address,
        'canonicalNaverPlaceId', b.naver_place_url,
        'verifiedPhone', null,
        'verifiedConcreteOfficialUrls', '[]'::jsonb,
        'branchIdentityKey', null
      )
      ORDER BY b.name,b.id
    ),
    '[]'::jsonb
  ) AS identities
  FROM public.businesses b
  WHERE b.active=true
    AND b.org_id=(SELECT org_id FROM run_scope)
), replay_rows AS (
  SELECT
    rm.measurement_id,
    jsonb_build_object(
      'measurementId', rm.measurement_id,
      'runId', rm.run_id,
      'orgId', rm.org_id,
      'businessId', rm.business_id,
      'questionId', rm.question_id,
      'questionText', COALESCE(rm.prompt_text,''),
      'intentType', rm.intent_type,
      'valid', rm.valid,
      'responseText', COALESCE(rm.response_text,''),
      'rawParser', jsonb_build_object(
        'wasClientMentioned', COALESCE(rm.was_client_mentioned,false),
        'clientPosition', rm.client_position
      ),
      'target', tc.target,
      'registeredBusinesses', COALESCE(rc.businesses,'[]'::jsonb),
      'storedMentions', COALESCE(mc.mentions,'[]'::jsonb),
      'attributions', COALESCE(ac.attributions,'[]'::jsonb)
    ) AS row_json
  FROM replay_measurements rm
  JOIN target_context tc ON tc.measurement_id=rm.measurement_id
  LEFT JOIN registered_context rc ON rc.measurement_id=rm.measurement_id
  LEFT JOIN mention_context mc ON mc.measurement_id=rm.measurement_id
  LEFT JOIN attribution_context ac ON ac.measurement_id=rm.measurement_id
), current_counts AS (
  SELECT jsonb_build_object(
    'measurementFactCount', (
      SELECT count(*)::integer
      FROM public.measurement_entity_facts_v2 f
      WHERE f.source_run_id=p_run_id
        AND f.fact_version='0.3'
        AND f.engine_version='entity-facts-v2:mef0.3:hist0.1:te0.3:src0.1:agg0.1:mat0.1'
    ),
    'aggregateRowCount', (
      SELECT count(*)::integer
      FROM public.run_entity_fact_aggregates_v2 a
      WHERE a.source_run_id=p_run_id
        AND a.fact_version='0.3'
        AND a.aggregate_version='0.1'
        AND a.engine_version='entity-facts-v2:mef0.3:hist0.1:te0.3:src0.1:agg0.1:mat0.1'
    ),
    'observedSourceRowCount', (
      SELECT count(*)::integer
      FROM public.run_observed_source_aggregates_v2 o
      WHERE o.source_run_id=p_run_id
        AND o.observed_sources_version='0.1'
        AND o.source_replay_version='0.1'
        AND o.engine_version='observed-sources-v2:src0.1:obs0.1:store0.1'
    ),
    'competitorSourceClueRowCount', (
      SELECT count(*)::integer
      FROM public.run_competitor_source_clue_aggregates_v2 c
      WHERE c.source_run_id=p_run_id
        AND c.clue_version='0.1'
        AND c.source_replay_version='0.1'
        AND c.engine_version='competitor-source-clues-v2:src0.1:clue0.1:store0.1'
    )
  ) AS value
)
SELECT CASE
  WHEN NOT EXISTS (SELECT 1 FROM run_scope) THEN null
  ELSE jsonb_build_object(
    'run', (
      SELECT jsonb_build_object(
        'runId', rs.id,
        'orgId', rs.org_id,
        'businessId', rs.business_id,
        'status', rs.status,
        'runType', rs.run_type,
        'phase', rs.phase,
        'experimentId', rs.experiment_id,
        'postprocessCompleted', EXISTS (
          SELECT 1
          FROM public.system_events se
          WHERE se.run_id=rs.id
            AND se.org_id=rs.org_id
            AND se.event_type='visibility_postprocess_completed'
            AND se.metadata->>'pipeline_version'='0.1.4'
        ),
        'citationAttributionCompleted', EXISTS (
          SELECT 1
          FROM public.system_events se
          WHERE se.run_id=rs.id
            AND se.org_id=rs.org_id
            AND se.event_type='visibility_citation_attribution_completed'
            AND se.metadata->>'attribution_version'='0.1.0'
        )
      )
      FROM run_scope rs
    ),
    'existing', (SELECT value FROM current_counts),
    'dataset', jsonb_build_object(
      'version','entity-facts-v2-runtime-input-v0.1',
      'publicIdentities',(SELECT identities FROM public_identity_directory),
      'rows',COALESCE(
        (SELECT jsonb_agg(row_json ORDER BY measurement_id) FROM replay_rows),
        '[]'::jsonb
      )
    )
  )
END;
$function$;

REVOKE ALL
  ON FUNCTION public.get_entity_facts_v2_runtime_context_v01(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE
  ON FUNCTION public.get_entity_facts_v2_runtime_context_v01(uuid)
  TO service_role;


CREATE OR REPLACE FUNCTION public.commit_entity_facts_v2_runtime_materialization_v01(
  p_run_id uuid,
  p_materialization_id uuid,
  p_engine_version text,
  p_measurement_rows jsonb,
  p_aggregate_row jsonb,
  p_observed_supplement jsonb,
  p_clue_supplement jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_run public.measurement_runs%ROWTYPE;
  v_expected_measurements integer;
  v_fact_count integer;
  v_aggregate_count integer;
  v_observed_count integer;
  v_clue_count integer;
  v_aggregate_id uuid;
  v_observed_id uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_run_id::text,0));

  SELECT *
    INTO v_run
  FROM public.measurement_runs
  WHERE id=p_run_id
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'RUNTIME_V2_RUN_NOT_FOUND';
  END IF;

  IF
    v_run.status <> 'completed'::public.run_status
    OR v_run.run_type <> 'audit'::public.run_type
    OR v_run.phase <> 'standalone'::public.run_phase
    OR v_run.experiment_id IS NOT NULL
  THEN
    RAISE EXCEPTION 'RUNTIME_V2_RUN_NOT_ELIGIBLE';
  END IF;

  IF p_engine_version <>
    'entity-facts-v2:mef0.3:hist0.1:te0.3:src0.1:agg0.1:mat0.1'
  THEN
    RAISE EXCEPTION 'RUNTIME_V2_ENGINE_VERSION_MISMATCH';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.system_events se
    WHERE se.org_id=v_run.org_id
      AND se.run_id=v_run.id
      AND se.event_type='visibility_postprocess_completed'
      AND se.metadata->>'pipeline_version'='0.1.4'
  ) THEN
    RAISE EXCEPTION 'RUNTIME_V2_POSTPROCESS_NOT_READY';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.system_events se
    WHERE se.org_id=v_run.org_id
      AND se.run_id=v_run.id
      AND se.event_type='visibility_citation_attribution_completed'
      AND se.metadata->>'attribution_version'='0.1.0'
  ) THEN
    RAISE EXCEPTION 'RUNTIME_V2_CITATION_ATTRIBUTION_NOT_READY';
  END IF;

  SELECT count(*)::integer
    INTO v_expected_measurements
  FROM public.measurements m
  WHERE m.org_id=v_run.org_id
    AND m.run_id=v_run.id;

  SELECT count(*)::integer INTO v_fact_count
  FROM public.measurement_entity_facts_v2 f
  WHERE f.source_run_id=v_run.id
    AND f.fact_version='0.3'
    AND f.engine_version=p_engine_version;

  SELECT count(*)::integer INTO v_aggregate_count
  FROM public.run_entity_fact_aggregates_v2 a
  WHERE a.source_run_id=v_run.id
    AND a.fact_version='0.3'
    AND a.aggregate_version='0.1'
    AND a.engine_version=p_engine_version;

  SELECT count(*)::integer INTO v_observed_count
  FROM public.run_observed_source_aggregates_v2 o
  WHERE o.source_run_id=v_run.id
    AND o.observed_sources_version='0.1'
    AND o.source_replay_version='0.1'
    AND o.engine_version='observed-sources-v2:src0.1:obs0.1:store0.1';

  SELECT count(*)::integer INTO v_clue_count
  FROM public.run_competitor_source_clue_aggregates_v2 c
  WHERE c.source_run_id=v_run.id
    AND c.clue_version='0.1'
    AND c.source_replay_version='0.1'
    AND c.engine_version='competitor-source-clues-v2:src0.1:clue0.1:store0.1';

  IF
    v_fact_count=v_expected_measurements
    AND v_aggregate_count=1
    AND v_observed_count=1
    AND v_clue_count=1
  THEN
    RETURN jsonb_build_object(
      'ok',true,
      'idempotent',true,
      'runId',v_run.id
    );
  END IF;

  IF v_fact_count>0 OR v_aggregate_count>0 OR v_observed_count>0 OR v_clue_count>0 THEN
    RAISE EXCEPTION 'RUNTIME_V2_PARTIAL_EXISTING_STATE';
  END IF;

  IF jsonb_typeof(p_measurement_rows) <> 'array'
     OR jsonb_array_length(p_measurement_rows) <> v_expected_measurements
  THEN
    RAISE EXCEPTION 'RUNTIME_V2_MEASUREMENT_PAYLOAD_COUNT_MISMATCH';
  END IF;

  INSERT INTO public.measurement_entity_facts_v2 (
    materialization_id,org_id,business_id,source_run_id,measurement_id,
    fact_version,engine_version,input_fingerprint,facts,facts_hash
  )
  SELECT
    (x->>'materialization_id')::uuid,
    (x->>'org_id')::uuid,
    (x->>'business_id')::uuid,
    (x->>'source_run_id')::uuid,
    (x->>'measurement_id')::uuid,
    x->>'fact_version',
    x->>'engine_version',
    x->>'input_fingerprint',
    x->'facts',
    x->>'facts_hash'
  FROM jsonb_array_elements(p_measurement_rows) x;

  INSERT INTO public.run_entity_fact_aggregates_v2 (
    materialization_id,org_id,business_id,source_run_id,
    fact_version,aggregate_version,engine_version,input_fingerprint,
    measurement_count,valid_measurement_count,contract_ok,aggregate,aggregate_hash
  ) VALUES (
    p_materialization_id,
    (p_aggregate_row->>'org_id')::uuid,
    (p_aggregate_row->>'business_id')::uuid,
    (p_aggregate_row->>'source_run_id')::uuid,
    p_aggregate_row->>'fact_version',
    p_aggregate_row->>'aggregate_version',
    p_aggregate_row->>'engine_version',
    p_aggregate_row->>'input_fingerprint',
    (p_aggregate_row->>'measurement_count')::integer,
    (p_aggregate_row->>'valid_measurement_count')::integer,
    (p_aggregate_row->>'contract_ok')::boolean,
    p_aggregate_row->'aggregate',
    p_aggregate_row->>'aggregate_hash'
  )
  RETURNING id INTO v_aggregate_id;

  INSERT INTO public.run_observed_source_aggregates_v2 (
    base_aggregate_id,base_materialization_id,org_id,business_id,source_run_id,
    observed_sources_version,source_replay_version,engine_version,
    input_fingerprint,observed_sources,observed_sources_hash
  ) VALUES (
    v_aggregate_id,
    p_materialization_id,
    v_run.org_id,
    v_run.business_id,
    v_run.id,
    p_observed_supplement->>'observed_sources_version',
    p_observed_supplement->>'source_replay_version',
    p_observed_supplement->>'engine_version',
    p_observed_supplement->>'input_fingerprint',
    p_observed_supplement->'observed_sources',
    p_observed_supplement->>'observed_sources_hash'
  )
  RETURNING id INTO v_observed_id;

  INSERT INTO public.run_competitor_source_clue_aggregates_v2 (
    base_aggregate_id,base_observed_source_aggregate_id,base_materialization_id,
    org_id,business_id,source_run_id,clue_version,source_replay_version,
    engine_version,input_fingerprint,source_clues,source_clues_hash
  ) VALUES (
    v_aggregate_id,
    v_observed_id,
    p_materialization_id,
    v_run.org_id,
    v_run.business_id,
    v_run.id,
    p_clue_supplement->>'clue_version',
    p_clue_supplement->>'source_replay_version',
    p_clue_supplement->>'engine_version',
    p_clue_supplement->>'input_fingerprint',
    p_clue_supplement->'source_clues',
    p_clue_supplement->>'source_clues_hash'
  );

  RETURN jsonb_build_object(
    'ok',true,
    'idempotent',false,
    'runId',v_run.id,
    'measurementFactCount',v_expected_measurements,
    'aggregateId',v_aggregate_id,
    'observedSourceAggregateId',v_observed_id
  );
END;
$function$;

REVOKE ALL
  ON FUNCTION public.commit_entity_facts_v2_runtime_materialization_v01(
    uuid,uuid,text,jsonb,jsonb,jsonb,jsonb
  )
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE
  ON FUNCTION public.commit_entity_facts_v2_runtime_materialization_v01(
    uuid,uuid,text,jsonb,jsonb,jsonb,jsonb
  )
  TO service_role;


-- Refresh path for completed runs whose stored parser/postprocess inputs changed
-- after the first immutable materialization. This updates the existing four
-- derived v2 rows atomically; it never deletes measurements, runs, or history.
CREATE OR REPLACE FUNCTION public.refresh_entity_facts_v2_runtime_materialization_v01(
  p_run_id uuid,
  p_materialization_id uuid,
  p_engine_version text,
  p_measurement_rows jsonb,
  p_aggregate_row jsonb,
  p_observed_supplement jsonb,
  p_clue_supplement jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_run public.measurement_runs%ROWTYPE;
  v_expected_measurements integer;
  v_fact_count integer;
  v_aggregate_count integer;
  v_observed_count integer;
  v_clue_count integer;
  v_updated integer;
  v_aggregate_id uuid;
  v_observed_id uuid;
  v_previous_materialization_id uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_run_id::text,0));

  SELECT * INTO v_run
  FROM public.measurement_runs
  WHERE id=p_run_id
  FOR SHARE;

  IF NOT FOUND THEN RAISE EXCEPTION 'RUNTIME_V2_RUN_NOT_FOUND'; END IF;

  IF v_run.status <> 'completed'::public.run_status
     OR v_run.run_type <> 'audit'::public.run_type
     OR v_run.phase <> 'standalone'::public.run_phase
     OR v_run.experiment_id IS NOT NULL
  THEN
    RAISE EXCEPTION 'RUNTIME_V2_RUN_NOT_ELIGIBLE';
  END IF;

  IF p_engine_version <> 'entity-facts-v2:mef0.3:hist0.1:te0.3:src0.1:agg0.1:mat0.1'
  THEN
    RAISE EXCEPTION 'RUNTIME_V2_ENGINE_VERSION_MISMATCH';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.system_events se
    WHERE se.org_id=v_run.org_id AND se.run_id=v_run.id
      AND se.event_type='visibility_postprocess_completed'
      AND se.metadata->>'pipeline_version'='0.1.4'
  ) THEN RAISE EXCEPTION 'RUNTIME_V2_POSTPROCESS_NOT_READY'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.system_events se
    WHERE se.org_id=v_run.org_id AND se.run_id=v_run.id
      AND se.event_type='visibility_citation_attribution_completed'
      AND se.metadata->>'attribution_version'='0.1.0'
  ) THEN RAISE EXCEPTION 'RUNTIME_V2_CITATION_ATTRIBUTION_NOT_READY'; END IF;

  SELECT count(*)::integer INTO v_expected_measurements
  FROM public.measurements m
  WHERE m.org_id=v_run.org_id AND m.run_id=v_run.id;

  SELECT count(*)::integer INTO v_fact_count
  FROM public.measurement_entity_facts_v2 f
  WHERE f.source_run_id=v_run.id AND f.fact_version='0.3'
    AND f.engine_version=p_engine_version;

  SELECT count(*)::integer, max(materialization_id)
    INTO v_aggregate_count, v_previous_materialization_id
  FROM public.run_entity_fact_aggregates_v2 a
  WHERE a.source_run_id=v_run.id AND a.fact_version='0.3'
    AND a.aggregate_version='0.1' AND a.engine_version=p_engine_version;

  SELECT count(*)::integer INTO v_observed_count
  FROM public.run_observed_source_aggregates_v2 o
  WHERE o.source_run_id=v_run.id AND o.observed_sources_version='0.1'
    AND o.source_replay_version='0.1'
    AND o.engine_version='observed-sources-v2:src0.1:obs0.1:store0.1';

  SELECT count(*)::integer INTO v_clue_count
  FROM public.run_competitor_source_clue_aggregates_v2 c
  WHERE c.source_run_id=v_run.id AND c.clue_version='0.1'
    AND c.source_replay_version='0.1'
    AND c.engine_version='competitor-source-clues-v2:src0.1:clue0.1:store0.1';

  IF v_fact_count<>v_expected_measurements
     OR v_aggregate_count<>1 OR v_observed_count<>1 OR v_clue_count<>1
  THEN
    RAISE EXCEPTION 'RUNTIME_V2_REFRESH_REQUIRES_FULL_EXISTING_STATE';
  END IF;

  IF jsonb_typeof(p_measurement_rows)<>'array'
     OR jsonb_array_length(p_measurement_rows)<>v_expected_measurements
  THEN
    RAISE EXCEPTION 'RUNTIME_V2_MEASUREMENT_PAYLOAD_COUNT_MISMATCH';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_measurement_rows) x
    WHERE (x->>'org_id')::uuid<>v_run.org_id
       OR (x->>'business_id')::uuid<>v_run.business_id
       OR (x->>'source_run_id')::uuid<>v_run.id
       OR x->>'fact_version'<>'0.3'
       OR x->>'engine_version'<>p_engine_version
  ) THEN
    RAISE EXCEPTION 'RUNTIME_V2_REFRESH_SCOPE_MISMATCH';
  END IF;

  IF (
    SELECT count(DISTINCT (x->>'measurement_id')::uuid)
    FROM jsonb_array_elements(p_measurement_rows) x
  ) <> v_expected_measurements THEN
    RAISE EXCEPTION 'RUNTIME_V2_REFRESH_MEASUREMENT_SET_MISMATCH';
  END IF;

  WITH payload AS (
    SELECT x FROM jsonb_array_elements(p_measurement_rows) x
  )
  UPDATE public.measurement_entity_facts_v2 f
     SET materialization_id=(p.x->>'materialization_id')::uuid,
         input_fingerprint=p.x->>'input_fingerprint',
         facts=p.x->'facts',
         facts_hash=p.x->>'facts_hash'
  FROM payload p
  WHERE f.source_run_id=v_run.id
    AND f.measurement_id=(p.x->>'measurement_id')::uuid
    AND f.fact_version='0.3'
    AND f.engine_version=p_engine_version;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated<>v_expected_measurements THEN
    RAISE EXCEPTION 'RUNTIME_V2_REFRESH_FACT_COUNT_MISMATCH';
  END IF;

  UPDATE public.run_entity_fact_aggregates_v2 a
     SET materialization_id=p_materialization_id,
         input_fingerprint=p_aggregate_row->>'input_fingerprint',
         measurement_count=(p_aggregate_row->>'measurement_count')::integer,
         valid_measurement_count=(p_aggregate_row->>'valid_measurement_count')::integer,
         contract_ok=(p_aggregate_row->>'contract_ok')::boolean,
         aggregate=p_aggregate_row->'aggregate',
         aggregate_hash=p_aggregate_row->>'aggregate_hash'
  WHERE a.source_run_id=v_run.id
    AND a.fact_version='0.3'
    AND a.aggregate_version='0.1'
    AND a.engine_version=p_engine_version
  RETURNING id INTO v_aggregate_id;
  IF v_aggregate_id IS NULL THEN RAISE EXCEPTION 'RUNTIME_V2_REFRESH_AGGREGATE_MISSING'; END IF;

  UPDATE public.run_observed_source_aggregates_v2 o
     SET base_aggregate_id=v_aggregate_id,
         base_materialization_id=p_materialization_id,
         input_fingerprint=p_observed_supplement->>'input_fingerprint',
         observed_sources=p_observed_supplement->'observed_sources',
         observed_sources_hash=p_observed_supplement->>'observed_sources_hash'
  WHERE o.source_run_id=v_run.id
    AND o.observed_sources_version='0.1'
    AND o.source_replay_version='0.1'
    AND o.engine_version='observed-sources-v2:src0.1:obs0.1:store0.1'
  RETURNING id INTO v_observed_id;
  IF v_observed_id IS NULL THEN RAISE EXCEPTION 'RUNTIME_V2_REFRESH_OBSERVED_MISSING'; END IF;

  UPDATE public.run_competitor_source_clue_aggregates_v2 c
     SET base_aggregate_id=v_aggregate_id,
         base_observed_source_aggregate_id=v_observed_id,
         base_materialization_id=p_materialization_id,
         input_fingerprint=p_clue_supplement->>'input_fingerprint',
         source_clues=p_clue_supplement->'source_clues',
         source_clues_hash=p_clue_supplement->>'source_clues_hash'
  WHERE c.source_run_id=v_run.id
    AND c.clue_version='0.1'
    AND c.source_replay_version='0.1'
    AND c.engine_version='competitor-source-clues-v2:src0.1:clue0.1:store0.1';
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated<>1 THEN RAISE EXCEPTION 'RUNTIME_V2_REFRESH_CLUE_COUNT_MISMATCH'; END IF;

  INSERT INTO public.system_events(
    org_id,run_id,event_type,severity,message,metadata
  ) VALUES (
    v_run.org_id,v_run.id,'entity_facts_v2_materialization_refreshed','info',
    'Entity Facts v2 materialization refreshed after stored-answer reparse.',
    jsonb_build_object(
      'engine_version',p_engine_version,
      'previous_materialization_id',v_previous_materialization_id,
      'materialization_id',p_materialization_id,
      'measurement_count',v_expected_measurements
    )
  );

  RETURN jsonb_build_object(
    'ok',true,'idempotent',false,'refreshed',true,'runId',v_run.id,
    'measurementFactCount',v_expected_measurements,
    'aggregateId',v_aggregate_id,
    'observedSourceAggregateId',v_observed_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.refresh_entity_facts_v2_runtime_materialization_v01(
  uuid,uuid,text,jsonb,jsonb,jsonb,jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_entity_facts_v2_runtime_materialization_v01(
  uuid,uuid,text,jsonb,jsonb,jsonb,jsonb
) TO service_role;
