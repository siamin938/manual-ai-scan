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
