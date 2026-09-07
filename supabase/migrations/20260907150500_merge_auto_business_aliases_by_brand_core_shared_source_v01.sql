create or replace function public.get_auto_business_brand_core_v01(p_name text)
returns text
language sql
immutable
set search_path to ''
as $function$
  select regexp_replace(
    regexp_replace(lower(normalize(coalesce(p_name,''), NFKC)), '[^0-9a-z가-힣]+', '', 'g'),
    '(ppf|필름|랩핑|래핑|썬팅|틴팅|tinting|tint|wrapping|wrap|디테일링|코팅|세차)$',
    '',
    'i'
  );
$function$;

create or replace function public.merge_auto_business_alias_by_shared_source_v01()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_core text;
  v_name text;
  v_key text;
begin
  if new.canonical_key is null or new.canonical_key not like 'auto:%' then
    return new;
  end if;

  v_core := public.get_auto_business_brand_core_v01(new.canonical_display_name);
  if v_core is null or length(v_core) < 3 then
    return new;
  end if;

  if not exists (
    select 1
    from public.measurement_entity_canonicalizations c2
    join public.measurement_mentions mm2
      on mm2.id = c2.measurement_mention_id
     and mm2.org_id = c2.org_id
    where c2.org_id = new.org_id
      and c2.business_id = new.business_id
      and c2.source_run_id = new.source_run_id
      and c2.resolver_version = new.resolver_version
      and c2.id <> new.id
      and c2.measurement_id <> new.measurement_id
      and c2.canonical_key like 'auto:%'
      and public.get_auto_business_brand_core_v01(mm2.display_name) = v_core
      and exists (
        select 1
        from public.measurement_sources s1
        join public.measurement_sources s2 on s2.url = s1.url
        where s1.org_id = new.org_id
          and s2.org_id = new.org_id
          and s1.measurement_id = new.measurement_id
          and s2.measurement_id = c2.measurement_id
          and s1.url ~ '^https?://[^/]+/.+'
      )
  ) then
    return new;
  end if;

  select mm.display_name
    into v_name
  from public.measurement_mentions mm
  join public.measurements m
    on m.id = mm.measurement_id
   and m.org_id = mm.org_id
  where mm.org_id = new.org_id
    and m.run_id = new.source_run_id
    and public.get_auto_business_brand_core_v01(mm.display_name) = v_core
  group by mm.display_name
  order by count(distinct mm.measurement_id) desc, length(mm.display_name) desc, mm.display_name asc
  limit 1;

  v_name := coalesce(nullif(v_name,''), new.canonical_display_name);
  v_key := 'auto:' || v_core;

  update public.measurement_entity_canonicalizations c
     set canonical_key = v_key,
         canonical_display_name = v_name,
         resolution_status = case when c.resolution_status = 'standalone' then 'merged' else c.resolution_status end,
         reason_codes = case
           when 'BRAND_CORE_SHARED_SOURCE_MERGE' = any(coalesce(c.reason_codes,'{}'::text[])) then c.reason_codes
           else array_append(coalesce(c.reason_codes,'{}'::text[]),'BRAND_CORE_SHARED_SOURCE_MERGE')
         end
   where c.org_id = new.org_id
     and c.business_id = new.business_id
     and c.source_run_id = new.source_run_id
     and c.resolver_version = new.resolver_version
     and c.canonical_key like 'auto:%'
     and public.get_auto_business_brand_core_v01(c.canonical_display_name) = v_core
     and (
       c.id = new.id
       or exists (
         select 1
         from public.measurement_sources s1
         join public.measurement_sources s2 on s2.url = s1.url
         where s1.org_id = new.org_id
           and s2.org_id = new.org_id
           and s1.measurement_id = new.measurement_id
           and s2.measurement_id = c.measurement_id
           and s1.url ~ '^https?://[^/]+/.+'
       )
     );

  return new;
end;
$function$;

drop trigger if exists trg_merge_auto_business_alias_by_shared_source_v01 on public.measurement_entity_canonicalizations;
create trigger trg_merge_auto_business_alias_by_shared_source_v01
after insert on public.measurement_entity_canonicalizations
for each row execute function public.merge_auto_business_alias_by_shared_source_v01();
