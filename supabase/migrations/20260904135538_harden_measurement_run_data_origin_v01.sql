create or replace function public.set_measurement_run_data_origin_v01()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_origin text;
begin
  select o.measurement_data_origin
    into v_origin
  from public.organizations o
  where o.id = new.org_id;

  if v_origin is null then
    raise exception 'MEASUREMENT_DATA_ORIGIN_NOT_CONFIGURED';
  end if;

  -- DB가 최종 권위값을 강제한다. 클라이언트/서버가 전달한 값은 신뢰하지 않는다.
  new.data_origin := v_origin;
  return new;
end;
$$;
