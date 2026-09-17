create function public.is_generic_location_business_description(p_name text)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(normalize(p_name,NFKC) ~ '(^|[[:space:]])(인근|근처|주변)[[:space:]]+((수입차|국산차|자동차|차량|엔진오일|타이어)[[:space:]]+)?((전문|사설|일반|전문적인)[[:space:]]+)*(정비소|정비업체|카센터|카센타|공업사|전문점)$',false);
$$;
revoke all on function public.is_generic_location_business_description(text) from public,anon,authenticated;
grant execute on function public.is_generic_location_business_description(text) to service_role;

create function public.guard_generic_location_mention()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.matched_business_id is null
     and not coalesce((new.resolution_evidence->>'canonical_name_match')::boolean,false)
     and public.is_generic_location_business_description(new.display_name) then
    new.entity_kind := 'generic_category';
    new.specificity := 'not_specific';
    new.count_as_confirmed_business := false;
    new.resolution_evidence := coalesce(new.resolution_evidence,'{}'::jsonb)
      || jsonb_build_object('generic_location_description_guard','v1');
  end if;
  return new;
end;
$$;
revoke all on function public.guard_generic_location_mention() from public,anon,authenticated;
create trigger measurement_mentions_guard_location_description
before insert or update on public.measurement_mentions
for each row execute function public.guard_generic_location_mention();

CREATE OR REPLACE FUNCTION public.get_auto_business_brand_core_v01(p_name text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select regexp_replace(
    regexp_replace(lower(normalize(regexp_replace(coalesce(p_name,''),'㈜|[(（][[:space:]]*주[[:space:]]*[)）]|주식회사','','g'), NFKC)), '[^0-9a-z가-힣]+', '', 'g'),
    '(ppf|필름|랩핑|래핑|썬팅|틴팅|tinting|tint|wrapping|wrap|디테일링|코팅|세차)$',
    '',
    'i'
  );
$function$;

CREATE OR REPLACE FUNCTION public.merge_auto_business_alias_by_shared_source_v01()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_core text;
  v_name text;
  v_key text;
begin
  if tg_op = 'UPDATE' and pg_trigger_depth() > 1 then return new; end if;
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

CREATE OR REPLACE FUNCTION public.guard_generic_heading_fragment_verification()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_name text;
  v_name_key text;
  v_matched_business_id uuid;
  v_evidence jsonb := '{}'::jsonb;
begin
  select mm.display_name, mm.matched_business_id, coalesce(mm.resolution_evidence,'{}'::jsonb)
    into v_name, v_matched_business_id, v_evidence
  from public.measurement_mentions mm
  where mm.id=new.measurement_mention_id
    and mm.org_id=new.org_id;

  if v_name is null or v_matched_business_id is not null then
    return new;
  end if;

  if coalesce((v_evidence->>'canonical_name_match')::boolean,false) then
    return new;
  end if;

  v_name_key := regexp_replace(lower(normalize(v_name,NFKC)),'[^0-9a-z가-힣]','','g');

  if v_name_key ~ '(문의해볼곳|문의할곳|상담해볼곳|상담할곳|찾아볼곳|추천해볼곳|추천할곳|비교할곳|맡길곳|시공할곳|확인할곳|고려할곳)$' or public.is_generic_location_business_description(v_name) then
    new.verification_status := 'rejected_non_business';
    new.verified_entity_kind := 'generic_category';
    new.verified_count_as_business := false;
    new.confidence := 'high';
    new.reason_codes := array_remove(coalesce(new.reason_codes,'{}'::text[]),'EVIDENCE_GATE_V01_PASS');
    new.reason_codes := array_remove(new.reason_codes,'EVIDENCE_GATE_V02_PASS');
    new.reason_codes := array_remove(new.reason_codes,'EVIDENCE_GATE_V02_STRONG_STRUCTURED');
    if not ('GENERIC_HEADING_FRAGMENT' = any(new.reason_codes)) then
      new.reason_codes := array_append(new.reason_codes,'GENERIC_HEADING_FRAGMENT');
    end if;
  end if;

  return new;
end;
$function$;

create trigger trg_recheck_auto_business_alias_on_name_update
after update of canonical_display_name on public.measurement_entity_canonicalizations
for each row execute function public.merge_auto_business_alias_by_shared_source_v01();

-- Pure policy checks run before correcting any stored derived records.
do $$
begin
 if not public.is_generic_location_business_description('도심로 인근 수입차 전문 사설 정비소')
    or public.is_generic_location_business_description('인근모터스 강남점')
    or public.is_generic_location_business_description('새빛자동차공업사')
    or public.get_auto_business_brand_core_v01('새빛㈜ 북부센터') <> public.get_auto_business_brand_core_v01('새빛 북부센터')
    or public.get_auto_business_brand_core_v01('새빛 북부센터') = public.get_auto_business_brand_core_v01('새빛 남부센터') then
   raise exception 'Entity correction policy regression';
 end if;
end;
$$;

create temporary table generic_correction_before on commit drop as
select mm.id, mm.org_id, m.run_id, to_jsonb(mm) as before_row,
 (select jsonb_agg(to_jsonb(v)) from public.measurement_entity_verifications v
  where v.measurement_mention_id=mm.id and v.org_id=mm.org_id) as before_verifications
from public.measurement_mentions mm join public.measurements m on m.id=mm.measurement_id and m.org_id=mm.org_id
where mm.count_as_confirmed_business=true and mm.matched_business_id is null
 and not coalesce((mm.resolution_evidence->>'canonical_name_match')::boolean,false)
 and public.is_generic_location_business_description(mm.display_name);

create temporary table corporate_correction_before on commit drop as
select c.id,c.org_id,c.business_id,c.source_run_id,c.measurement_mention_id,
 c.canonical_key,c.canonical_display_name,c.resolver_version
from public.measurement_entity_canonicalizations c
where exists (
 select 1 from public.measurement_entity_canonicalizations f
 where f.org_id=c.org_id and f.business_id=c.business_id and f.source_run_id=c.source_run_id
 and f.resolver_version=c.resolver_version
 and f.canonical_display_name ~ '㈜|[(（][[:space:]]*주[[:space:]]*[)）]|주식회사'
 and public.get_auto_business_brand_core_v01(f.canonical_display_name)=public.get_auto_business_brand_core_v01(c.canonical_display_name)
);
do $$
begin
 if (select count(*) from generic_correction_before)>100 or (select count(*) from corporate_correction_before)>100 then
  raise exception 'Correction scope exceeds reviewed bound';
 end if;
end;
$$;

update public.measurement_mentions mm set display_name=mm.display_name
where mm.id in (select id from generic_correction_before);
update public.measurement_entity_verifications v set verification_status=v.verification_status
where v.measurement_mention_id in (select id from generic_correction_before);

do $$
declare candidate record;
begin
 for candidate in select c.id from public.measurement_entity_canonicalizations c
  join corporate_correction_before b on b.id=c.id
  where c.canonical_key like 'auto:%'
  and c.canonical_display_name ~ '㈜|[(（][[:space:]]*주[[:space:]]*[)）]|주식회사'
 loop
  update public.measurement_entity_canonicalizations set canonical_display_name=canonical_display_name where id=candidate.id;
 end loop;
end;
$$;

-- Keep existing source attribution references aligned, without recomputing citations.
with latest_corrected as (
 select distinct on (c.org_id,c.business_id,c.source_run_id,c.measurement_mention_id) c.*
 from public.measurement_entity_canonicalizations c
 join corporate_correction_before b on b.id=c.id
 where c.canonical_key is distinct from b.canonical_key
 order by c.org_id,c.business_id,c.source_run_id,c.measurement_mention_id,string_to_array(c.resolver_version,'.')::int[] desc
)
update public.measurement_citation_attributions a set canonical_key=c.canonical_key
from latest_corrected c where a.org_id=c.org_id and a.business_id=c.business_id
 and a.source_run_id=c.source_run_id and a.measurement_mention_id=c.measurement_mention_id
 and a.canonical_key is distinct from c.canonical_key;

-- Preserve the previous derived classification and keys in organization-scoped audit events.
insert into public.system_events(org_id,run_id,event_type,severity,message,metadata)
select org_id,run_id,'entity_description_correction','info','Generic location description excluded from business counts.',
 jsonb_build_object('before_mention',before_row,'before_verifications',before_verifications,'policy','generic_location_description_v1')
from generic_correction_before;
insert into public.system_events(org_id,run_id,event_type,severity,message,metadata)
select b.org_id,b.source_run_id,'entity_corporate_notation_correction','info','Corporate notation aliases reconciled using shared source evidence.',
 jsonb_build_object('before',to_jsonb(b),'after_key',c.canonical_key,'after_name',c.canonical_display_name)
from corporate_correction_before b join public.measurement_entity_canonicalizations c on c.id=b.id
where b.canonical_key is distinct from c.canonical_key;

