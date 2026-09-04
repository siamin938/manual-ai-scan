alter table public.organizations
  add column if not exists measurement_data_origin text;

update public.organizations o
set measurement_data_origin = 'internal_observation'
where o.measurement_data_origin is null
  and exists (
    select 1 from public.measurement_runs r where r.org_id = o.id
  );

update public.organizations
set measurement_data_origin = 'customer_measurement'
where measurement_data_origin is null;

alter table public.organizations
  alter column measurement_data_origin set default 'customer_measurement',
  alter column measurement_data_origin set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'organizations_measurement_data_origin_check'
      and conrelid = 'public.organizations'::regclass
  ) then
    alter table public.organizations
      add constraint organizations_measurement_data_origin_check
      check (measurement_data_origin in ('internal_observation','customer_measurement','demo'));
  end if;
end $$;

alter table public.measurement_runs
  add column if not exists data_origin text;

update public.measurement_runs r
set data_origin = coalesce(o.measurement_data_origin, 'internal_observation')
from public.organizations o
where o.id = r.org_id
  and r.data_origin is null;

update public.measurement_runs
set data_origin = 'internal_observation'
where data_origin is null;

alter table public.measurement_runs
  alter column data_origin set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'measurement_runs_data_origin_check'
      and conrelid = 'public.measurement_runs'::regclass
  ) then
    alter table public.measurement_runs
      add constraint measurement_runs_data_origin_check
      check (data_origin in ('internal_observation','customer_measurement','demo'));
  end if;
end $$;

create or replace function public.set_measurement_run_data_origin_v01()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_origin text;
begin
  if new.data_origin is null then
    select o.measurement_data_origin
      into v_origin
    from public.organizations o
    where o.id = new.org_id;

    new.data_origin := coalesce(v_origin, 'internal_observation');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_measurement_runs_data_origin_v01 on public.measurement_runs;
create trigger trg_measurement_runs_data_origin_v01
before insert on public.measurement_runs
for each row
execute function public.set_measurement_run_data_origin_v01();

create or replace function public.get_compatible_audit_runs_v01(
  p_org_id uuid,
  p_business_id uuid,
  p_limit integer default 6
)
returns table(run_id uuid, completed_at timestamptz, created_at timestamptz)
language sql
stable
security definer
set search_path to 'public'
as $function$
with latest as (
  select r.id, r.question_set_id, r.selected_providers, r.repetitions, r.data_origin
  from public.measurement_runs r
  where r.org_id = p_org_id
    and r.business_id = p_business_id
    and r.run_type = 'audit'::run_type
    and r.phase = 'standalone'::run_phase
    and r.status = 'completed'::run_status
    and r.experiment_id is null
  order by r.completed_at desc nulls last, r.created_at desc
  limit 1
), candidates as (
  select r.id, r.question_set_id, r.selected_providers, r.repetitions, r.data_origin, r.completed_at, r.created_at
  from public.measurement_runs r
  join latest l
    on l.question_set_id = r.question_set_id
   and l.data_origin = r.data_origin
  where r.org_id = p_org_id
    and r.business_id = p_business_id
    and r.run_type = 'audit'::run_type
    and r.phase = 'standalone'::run_phase
    and r.status = 'completed'::run_status
    and r.experiment_id is null
  order by r.completed_at desc nulls last, r.created_at desc
  limit greatest(1, least(coalesce(p_limit, 6), 20))
), job_contract as (
  select
    c.id as run_id,
    count(j.id)::integer as job_count,
    bool_and(pp.job_id is not null) as payload_complete,
    jsonb_agg(
      jsonb_build_object(
        'question_id', j.question_id,
        'provider', j.provider,
        'provider_model', j.provider_model,
        'repetition_no', j.repetition_no,
        'request', pp.request_payload_redacted
      )
      order by j.question_id, j.provider, j.repetition_no
    ) as contract
  from candidates c
  join public.measurement_jobs j
    on j.org_id = p_org_id and j.run_id = c.id
  left join public.provider_payloads pp
    on pp.org_id = p_org_id and pp.job_id = j.id
  group by c.id
), measurement_contract as (
  select
    c.id as run_id,
    count(m.id)::integer as measurement_count,
    array_agg(distinct m.parser_version order by m.parser_version) as parser_versions
  from candidates c
  join public.measurements m
    on m.org_id = p_org_id and m.run_id = c.id
  group by c.id
), base as (
  select
    c.*,
    jc.job_count,
    jc.payload_complete,
    jc.contract,
    mc.measurement_count,
    mc.parser_versions
  from candidates c
  join job_contract jc on jc.run_id = c.id
  join measurement_contract mc on mc.run_id = c.id
), latest_contract as (
  select b.*
  from base b
  join latest l on l.id = b.id
)
select b.id, b.completed_at, b.created_at
from base b
cross join latest_contract lc
where b.data_origin = lc.data_origin
  and b.selected_providers = lc.selected_providers
  and b.repetitions = lc.repetitions
  and b.job_count = lc.job_count
  and b.measurement_count = lc.measurement_count
  and b.parser_versions = lc.parser_versions
  and b.payload_complete = true
  and lc.payload_complete = true
  and b.contract = lc.contract
order by b.completed_at desc nulls last, b.created_at desc;
$function$;
