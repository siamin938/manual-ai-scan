-- CHABOIM observed-source supplement backfill base export.
-- READ ONLY. No provider call. No mutation.
--
-- This exports only the immutable Entity Facts v2 aggregate rows that the
-- observed-source supplement is allowed to reference.

select jsonb_build_object(
  'version', 'observed-source-v2-backfill-base-v0.1',
  'rows', coalesce(
    jsonb_agg(
      jsonb_build_object(
        'baseAggregateId', a.id,
        'baseMaterializationId', a.materialization_id,
        'orgId', a.org_id,
        'businessId', a.business_id,
        'sourceRunId', a.source_run_id,
        'factVersion', a.fact_version,
        'aggregateVersion', a.aggregate_version,
        'engineVersion', a.engine_version,
        'aggregateHash', a.aggregate_hash,
        'aggregate', a.aggregate
      )
      order by a.source_run_id
    ),
    '[]'::jsonb
  )
)::text as base_json
from public.run_entity_fact_aggregates_v2 a
where a.fact_version='0.3'
  and a.aggregate_version='0.1'
  and a.engine_version='entity-facts-v2:mef0.3:hist0.1:te0.3:src0.1:agg0.1:mat0.1'
  and a.contract_ok=true;
