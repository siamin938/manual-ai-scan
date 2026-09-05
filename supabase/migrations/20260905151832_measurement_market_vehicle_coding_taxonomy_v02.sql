do $migration$
declare
  v_def text;
  v_old text := $old$      ('detailing','디테일링','디테일링',false,110),$old$;
  v_new text := $new$      ('vehicle_coding','자동차 코딩·기능 활성화','(자동차 *코딩|차량 *코딩|옵션 *코딩|기능 *활성화|ECU *코딩|코딩)',false,105),
      ('detailing','디테일링','디테일링',false,110),$new$;
begin
  select pg_get_functiondef('public.resolve_measurement_market_profile_candidate_v02(uuid)'::regprocedure)
    into v_def;

  if position(v_old in v_def) = 0 then
    raise exception 'EXPECTED_TAXONOMY_INSERT_POINT_NOT_FOUND';
  end if;

  v_def := replace(v_def, v_old, v_new);
  v_def := replace(v_def, '''version'',''0.2.1''', '''version'',''0.2.2''');
  v_def := replace(v_def, '''taxonomyVersion'',''automotive_v0.1''', '''taxonomyVersion'',''automotive_v0.2''');
  v_def := replace(v_def, '''resolverVersion'',''0.2.1''', '''resolverVersion'',''0.2.2''');

  execute v_def;
end;
$migration$;
