create or replace function public.get_repeat_independent_site_observations_v02(p_org_id uuid, p_business_id uuid)
returns table(
  source_key text,
  source_name text,
  source_group_key text,
  competitor_response_count integer,
  distinct_competitor_count integer,
  intent_count integer,
  question_count integer,
  client_response_count integer,
  compatible_run_count integer,
  competitor_run_presence_count integer,
  client_run_presence_count integer,
  linked_competitors jsonb,
  domains jsonb,
  sample_questions jsonb
)
language sql
stable
set search_path to ''
as $function$
select
  o.source_key,
  o.source_name,
  o.source_group_key,
  o.competitor_response_count,
  o.distinct_competitor_count,
  o.intent_count,
  o.question_count,
  o.client_response_count,
  o.compatible_run_count,
  o.competitor_run_presence_count,
  o.client_run_presence_count,
  coalesce(
    (
      select jsonb_build_array(x.item)
      from jsonb_array_elements(coalesce(o.linked_competitors,'[]'::jsonb)) as x(item)
      order by
        case
          when lower(
            regexp_replace(
              split_part(split_part(coalesce(x.item->>'url',''), '?', 1), '#', 1),
              '^https?://(www\.)?',
              '',
              'i'
            )
          ) in (lower(o.source_name), lower(o.source_name)||'/') then 0
          else 1
        end,
        length(coalesce(x.item->>'url','')),
        coalesce(x.item->>'url','')
      limit 1
    ),
    '[]'::jsonb
  ) as linked_competitors,
  o.domains,
  o.sample_questions
from public.get_repeat_independent_site_observations_v01(p_org_id,p_business_id) o
where exists (
  select 1
  from public.measurement_citation_attributions a
  join public.get_compatible_audit_runs_v01(p_org_id,p_business_id,6) c
    on c.run_id=a.source_run_id
  where a.org_id=p_org_id
    and a.business_id=p_business_id
    and lower(a.domain)=lower(o.source_name)
    and a.citation_url is not null
    and lower(
      regexp_replace(
        split_part(split_part(a.citation_url,'?',1),'#',1),
        '^https?://(www\.)?',
        '',
        'i'
      )
    ) in (lower(o.source_name), lower(o.source_name)||'/')
);
$function$;

revoke all on function public.get_repeat_independent_site_observations_v02(uuid,uuid) from public, anon, authenticated;
grant execute on function public.get_repeat_independent_site_observations_v02(uuid,uuid) to service_role;
