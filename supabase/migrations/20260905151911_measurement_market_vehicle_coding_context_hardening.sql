do $migration$
declare
  v_def text;
  v_old text := $$      ('vehicle_coding','자동차 코딩·기능 활성화','(자동차 *코딩|차량 *코딩|옵션 *코딩|기능 *활성화|ECU *코딩|코딩)',false,105),$$;
  v_new text := $$      ('vehicle_coding','자동차 코딩·기능 활성화','(자동차 *코딩|차량 *코딩|옵션 *코딩|기능 *활성화|ECU *코딩|코딩 *전문)',false,105),$$;
begin
  select pg_get_functiondef('public.resolve_measurement_market_profile_candidate_v02(uuid)'::regprocedure)
    into v_def;
  if position(v_old in v_def)=0 then raise exception 'EXPECTED_VEHICLE_CODING_PATTERN_NOT_FOUND'; end if;
  v_def := replace(v_def, v_old, v_new);
  execute v_def;
end;
$migration$;
