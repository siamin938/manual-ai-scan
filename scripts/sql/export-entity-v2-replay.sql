-- Entity Engine v2 historical shadow replay export.
-- READ ONLY. This query does not mutate production data and does not call any AI provider.
--
-- Recommended usage:
--   psql "$DATABASE_URL" -At -f scripts/sql/export-entity-v2-replay.sql \
--     > .tmp/entity-v2-replay.json
--
-- Output is one wrapped JSON dataset that can be passed directly to:
--   bun scripts/entity-v2-shadow-replay.ts .tmp/entity-v2-replay.json [review-registry.json]
--
-- Do NOT commit the generated output: it contains stored AI answer text and
-- organization-scoped measurement data.

with eligible_measurements as (
  select
    m.id as measurement_id,
    m.org_id,
    m.run_id,
    m.question_id,
    m.response_text,
    r.business_id
  from public.measurements m
  join public.measurement_runs r
    on r.id=m.run_id
   and r.org_id=m.org_id
  where m.valid=true
    and r.run_type='audit'::public.run_type
    and r.phase='standalone'::public.run_phase
    and r.status='completed'::public.run_status
    and r.experiment_id is null
    and r.data_origin in ('internal_observation','customer_measurement')
), v1_entities as (
  select
    em.measurement_id,
    jsonb_agg(
      jsonb_build_object(
        'displayName', mm.display_name,
        'verificationStatus', ev.verification_status,
        'verifiedEntityKind', ev.verified_entity_kind,
        'matchedBusinessId', mm.matched_business_id,
        'canonicalKey', c.canonical_key,
        'canonicalDisplayName', c.canonical_display_name,
        'reasonCodes', ev.reason_codes
      )
      order by mm.display_name, mm.id
    ) as entities
  from eligible_measurements em
  join public.measurement_mentions mm
    on mm.org_id=em.org_id
   and mm.measurement_id=em.measurement_id
  join public.measurement_entity_verifications ev
    on ev.org_id=em.org_id
   and ev.business_id=em.business_id
   and ev.measurement_id=em.measurement_id
   and ev.measurement_mention_id=mm.id
   and ev.verifier_version='0.1.5'
  left join lateral (
    select cc.canonical_key, cc.canonical_display_name
    from public.measurement_entity_canonicalizations cc
    where cc.org_id=em.org_id
      and cc.business_id=em.business_id
      and cc.measurement_id=em.measurement_id
      and cc.measurement_mention_id=mm.id
      and cc.resolver_version='0.1.1'
    order by cc.created_at desc
    limit 1
  ) c on true
  group by em.measurement_id
), business_context as (
  select
    em.measurement_id,
    jsonb_agg(
      jsonb_build_object(
        'id', b.id,
        'name', b.name,
        'aliases', coalesce(b.aliases,'{}'::text[])
      )
      order by b.name,b.id
    ) as businesses
  from eligible_measurements em
  join public.businesses b
    on b.org_id=em.org_id
   and b.id in (
      select em.business_id
      union
      select bc.competitor_business_id
      from public.business_competitors bc
      where bc.org_id=em.org_id
        and bc.target_business_id=em.business_id
        and bc.active=true
      union
      select mm2.matched_business_id
      from public.measurement_mentions mm2
      where mm2.org_id=em.org_id
        and mm2.measurement_id=em.measurement_id
        and mm2.matched_business_id is not null
   )
  group by em.measurement_id
), replay_rows as (
  select
    em.run_id,
    em.measurement_id,
    jsonb_build_object(
      'measurementId', em.measurement_id,
      'runId', em.run_id,
      'clientBusinessId', em.business_id,
      'responseText', em.response_text,
      'businesses', coalesce(bc.businesses,'[]'::jsonb),
      'v1Entities', coalesce(v1.entities,'[]'::jsonb)
    ) as row_json
  from eligible_measurements em
  left join v1_entities v1 on v1.measurement_id=em.measurement_id
  left join business_context bc on bc.measurement_id=em.measurement_id
)
select jsonb_build_object(
  'version', 'production-export-v0.1',
  'source', 'Stored CHABOIM completed standalone audit measurements; read-only export.',
  'rows', coalesce(
    jsonb_agg(row_json order by run_id, measurement_id),
    '[]'::jsonb
  )
)::text
from replay_rows;
