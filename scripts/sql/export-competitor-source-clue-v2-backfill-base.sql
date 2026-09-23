-- CHABOIM competitor-source-clue supplement backfill base export.
-- READ ONLY. No provider call. No mutation.

select jsonb_build_object(
  'version', 'competitor-source-clue-v2-backfill-base-v0.1',
  'rows', coalesce(
    jsonb_agg(
      jsonb_build_object(
        'baseAggregateId', a.id,
        'baseObservedSourceAggregateId', o.id,
        'baseMaterializationId', a.materialization_id,
        'orgId', a.org_id,
        'businessId', a.business_id,
        'sourceRunId', a.source_run_id,
        'baseAggregateHash', a.aggregate_hash,
        'observedSourcesHash', o.observed_sources_hash,
        'aggregate', a.aggregate,
        'observedSources', o.observed_sources
      )
      order by a.source_run_id
    ),
    '[]'::jsonb
  )
)::text as base_json
from public.run_entity_fact_aggregates_v2 a
join public.run_observed_source_aggregates_v2 o
  on o.base_aggregate_id=a.id
 and o.base_materialization_id=a.materialization_id
 and o.org_id=a.org_id
 and o.business_id=a.business_id
 and o.source_run_id=a.source_run_id
where a.fact_version='0.3'
  and a.aggregate_version='0.1'
  and a.engine_version='entity-facts-v2:mef0.3:hist0.1:te0.3:src0.1:agg0.1:mat0.1'
  and a.contract_ok=true
  and o.observed_sources_version='0.1'
  and o.source_replay_version='0.1'
  and o.engine_version='observed-sources-v2:src0.1:obs0.1:store0.1';
