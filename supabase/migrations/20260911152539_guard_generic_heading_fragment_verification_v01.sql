create or replace function public.guard_generic_heading_fragment_verification()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
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

  if v_name_key ~ '(문의해볼곳|문의할곳|상담해볼곳|상담할곳|찾아볼곳|추천해볼곳|추천할곳|비교할곳|맡길곳|시공할곳|확인할곳|고려할곳)$' then
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

revoke all on function public.guard_generic_heading_fragment_verification() from public, anon, authenticated;
grant execute on function public.guard_generic_heading_fragment_verification() to service_role;

drop trigger if exists measurement_entity_verifications_guard_generic_heading_fragment on public.measurement_entity_verifications;
create trigger measurement_entity_verifications_guard_generic_heading_fragment
before insert or update on public.measurement_entity_verifications
for each row execute function public.guard_generic_heading_fragment_verification();

update public.measurement_entity_verifications v
set verification_status=v.verification_status
from public.measurement_mentions mm
where mm.id=v.measurement_mention_id
  and mm.org_id=v.org_id
  and mm.matched_business_id is null
  and not coalesce((mm.resolution_evidence->>'canonical_name_match')::boolean,false)
  and regexp_replace(lower(normalize(mm.display_name,NFKC)),'[^0-9a-z가-힣]','','g') ~ '(문의해볼곳|문의할곳|상담해볼곳|상담할곳|찾아볼곳|추천해볼곳|추천할곳|비교할곳|맡길곳|시공할곳|확인할곳|고려할곳)$';

delete from public.measurement_citation_attributions a
where exists (
  select 1
  from public.measurement_entity_canonicalizations c
  join public.measurement_mentions mm
    on mm.id=c.measurement_mention_id
   and mm.org_id=c.org_id
  where c.org_id=a.org_id
    and c.business_id=a.business_id
    and c.source_run_id=a.source_run_id
    and c.measurement_id=a.measurement_id
    and c.canonical_key=a.canonical_key
    and mm.matched_business_id is null
    and not coalesce((mm.resolution_evidence->>'canonical_name_match')::boolean,false)
    and regexp_replace(lower(normalize(mm.display_name,NFKC)),'[^0-9a-z가-힣]','','g') ~ '(문의해볼곳|문의할곳|상담해볼곳|상담할곳|찾아볼곳|추천해볼곳|추천할곳|비교할곳|맡길곳|시공할곳|확인할곳|고려할곳)$'
);

delete from public.measurement_entity_canonicalizations c
using public.measurement_mentions mm
where mm.id=c.measurement_mention_id
  and mm.org_id=c.org_id
  and mm.matched_business_id is null
  and not coalesce((mm.resolution_evidence->>'canonical_name_match')::boolean,false)
  and regexp_replace(lower(normalize(mm.display_name,NFKC)),'[^0-9a-z가-힣]','','g') ~ '(문의해볼곳|문의할곳|상담해볼곳|상담할곳|찾아볼곳|추천해볼곳|추천할곳|비교할곳|맡길곳|시공할곳|확인할곳|고려할곳)$';