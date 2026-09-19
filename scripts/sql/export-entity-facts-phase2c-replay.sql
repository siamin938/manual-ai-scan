-- CHABOIM P0 Phase 2C historical Measurement Entity Facts replay export.
-- READ ONLY. No AI provider call. No mutation. Generated output is sensitive and
-- must remain ephemeral; do not commit it.
--
-- This export intentionally does NOT treat website_url/official_domains as
-- verified concrete official URLs. Phase 2A requires verified URL provenance.
-- It also does not invent phone or branchIdentityKey evidence that is not
-- persisted in the current businesses schema.

with eligible_runs as (
  select
    r.id as run_id,
    r.org_id,
    r.business_id,
    r.completed_at
  from public.measurement_runs r
  where r.run_type='audit'::public.run_type
    and r.phase='standalone'::public.run_phase
    and r.status='completed'::public.run_status
    and r.experiment_id is null
    and r.data_origin in ('internal_observation','customer_measurement')
), replay_measurements as (
  select
    m.id as measurement_id,
    m.org_id,
    m.run_id,
    m.question_id,
    m.response_text,
    m.was_client_mentioned,
    m.client_position,
    m.valid,
    er.business_id,
    er.completed_at,
    q.prompt_text,
    coalesce(nullif(q.intent_type,''),'other') as intent_type
  from public.measurements m
  join eligible_runs er
    on er.run_id=m.run_id
   and er.org_id=m.org_id
  left join public.questions q
    on q.id=m.question_id
   and q.org_id=m.org_id
), target_context as (
  select
    rm.measurement_id,
    jsonb_build_object(
      'id', b.id,
      'name', b.name,
      'aliases', coalesce(b.aliases,'{}'::text[]),
      'fullAddress', b.address,
      'canonicalNaverPlaceId', b.naver_place_url,
      'verifiedPhone', null,
      'verifiedConcreteOfficialUrls', '[]'::jsonb,
      'branchIdentityKey', null
    ) as target
  from replay_measurements rm
  join public.businesses b
    on b.id=rm.business_id
   and b.org_id=rm.org_id
), registered_context as (
  select
    rm.measurement_id,
    jsonb_agg(
      jsonb_build_object(
        'id', b.id,
        'name', b.name,
        'aliases', coalesce(b.aliases,'{}'::text[]),
        'fullAddress', b.address,
        'canonicalNaverPlaceId', b.naver_place_url,
        'verifiedPhone', null,
        'verifiedConcreteOfficialUrls', '[]'::jsonb,
        'branchIdentityKey', null
      )
      order by b.name,b.id
    ) as businesses
  from replay_measurements rm
  join public.businesses b
    on b.org_id=rm.org_id
   and b.active=true
  group by rm.measurement_id
), mention_context as (
  select
    rm.measurement_id,
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
      order by mm.position nulls last, mm.display_name, mm.id
    ) as mentions
  from replay_measurements rm
  join public.measurement_mentions mm
    on mm.measurement_id=rm.measurement_id
   and mm.org_id=rm.org_id
  left join lateral (
    select
      c.canonical_key,
      c.canonical_display_name
    from public.measurement_entity_canonicalizations c
    where c.measurement_id=rm.measurement_id
      and c.measurement_mention_id=mm.id
      and c.org_id=rm.org_id
      and c.business_id=rm.business_id
    order by c.created_at desc, c.id desc
    limit 1
  ) cc on true
  group by rm.measurement_id
), attribution_context as (
  select
    rm.measurement_id,
    jsonb_agg(
      jsonb_build_object(
        'attributionId', a.id,
        'measurementMentionId', a.measurement_mention_id,
        'canonicalKey', a.canonical_key,
        'domain', a.domain,
        'url', a.citation_url,
        'attributionLevel', a.attribution_level,
        'evidence', a.evidence,
        'citationStartIndex', a.citation_start_index,
        'entityEndIndex', a.entity_end_index
      )
      order by a.id
    ) as attributions
  from replay_measurements rm
  join public.measurement_citation_attributions a
    on a.measurement_id=rm.measurement_id
   and a.org_id=rm.org_id
   and a.business_id=rm.business_id
   and a.attribution_version='0.1.0'
  group by rm.measurement_id
), public_identity_directory as (
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'name', b.name,
        'aliases', coalesce(b.aliases,'{}'::text[]),
        'fullAddress', b.address,
        'canonicalNaverPlaceId', b.naver_place_url,
        'verifiedPhone', null,
        'verifiedConcreteOfficialUrls', '[]'::jsonb,
        'branchIdentityKey', null
      )
      order by b.name,b.id
    ),
    '[]'::jsonb
  ) as identities
  from public.businesses b
  where b.active=true
), replay_rows as (
  select
    rm.run_id,
    rm.measurement_id,
    jsonb_build_object(
      'measurementId', rm.measurement_id,
      'runId', rm.run_id,
      'businessId', rm.business_id,
      'questionId', rm.question_id,
      'questionText', coalesce(rm.prompt_text,''),
      'intentType', rm.intent_type,
      'valid', rm.valid,
      'responseText', coalesce(rm.response_text,''),
      'rawParser', jsonb_build_object(
        'wasClientMentioned', coalesce(rm.was_client_mentioned,false),
        'clientPosition', rm.client_position
      ),
      'target', tc.target,
      'registeredBusinesses', coalesce(rc.businesses,'[]'::jsonb),
      'storedMentions', coalesce(mc.mentions,'[]'::jsonb),
      'attributions', coalesce(ac.attributions,'[]'::jsonb)
    ) as row_json
  from replay_measurements rm
  join target_context tc on tc.measurement_id=rm.measurement_id
  left join registered_context rc on rc.measurement_id=rm.measurement_id
  left join mention_context mc on mc.measurement_id=rm.measurement_id
  left join attribution_context ac on ac.measurement_id=rm.measurement_id
)
select jsonb_build_object(
  'version', 'entity-facts-phase2c-export-v0.1',
  'source', 'Stored CHABOIM completed standalone audits; Phase 2C read-only replay dataset.',
  'publicIdentities', (select identities from public_identity_directory),
  'rows', coalesce(
    jsonb_agg(row_json order by run_id, measurement_id),
    '[]'::jsonb
  )
)::text
from replay_rows;
