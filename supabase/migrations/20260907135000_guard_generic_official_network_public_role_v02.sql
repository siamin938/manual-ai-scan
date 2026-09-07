create or replace function public.guard_generic_official_network_verification()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  v_name text;
  v_matched_business_id uuid;
begin
  select mm.display_name, mm.matched_business_id
    into v_name, v_matched_business_id
  from public.measurement_mentions mm
  where mm.id = new.measurement_mention_id
    and mm.org_id = new.org_id;

  if v_name is not null
     and v_matched_business_id is null
     and normalize(v_name, NFKC) ~* '^\s*[0-9A-Za-z가-힣._+-]{1,30}\s+(공식|공인)\s+(인증점|취급점|시공점|대리점|판매점|협력점)\s*$' then
    new.verification_status := 'rejected_non_business';
    new.verified_entity_kind := 'brand_network';
    new.verified_count_as_business := false;
    new.confidence := 'high';
    new.reason_codes := array['GENERIC_OFFICIAL_NETWORK']::text[];
  end if;

  return new;
end;
$function$;
