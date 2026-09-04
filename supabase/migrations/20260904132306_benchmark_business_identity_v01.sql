create or replace function public.get_benchmark_business_identity_key_v01(
  p_business_id uuid,
  p_name text,
  p_country_code text,
  p_region text,
  p_city text,
  p_address text
)
returns text
language plpgsql
immutable
set search_path to ''
as $function$
declare
  v_name text := regexp_replace(lower(coalesce(p_name,'')), '[^0-9a-z가-힣]', '', 'g');
  v_country text := regexp_replace(lower(coalesce(p_country_code,'')), '[^0-9a-z가-힣]', '', 'g');
  v_region text := regexp_replace(lower(coalesce(p_region,'')), '[^0-9a-z가-힣]', '', 'g');
  v_city text := regexp_replace(lower(coalesce(p_city,'')), '[^0-9a-z가-힣]', '', 'g');
  v_road text;
begin
  v_road := regexp_replace(
    coalesce(substring(lower(coalesce(p_address,'')) from '([0-9a-z가-힣]+(?:대로|로|길)[[:space:]]*[0-9]+(?:-[0-9]+)?)'),''),
    '[^0-9a-z가-힣]', '', 'g'
  );

  if v_name <> '' and v_country <> '' and v_region <> '' and v_city <> '' and v_road <> '' then
    return 'v01:' || v_country || ':' || v_region || ':' || v_city || ':' || v_road || ':' || v_name;
  end if;

  -- Fail closed: evidence가 부족하면 서로 다른 등록 객체를 자동 병합하지 않는다.
  return 'business:' || p_business_id::text;
end;
$function$;
