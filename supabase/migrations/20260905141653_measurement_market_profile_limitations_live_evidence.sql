do $migration$
declare
  v_def text;
  v_old text := '공개 웹 근거는 현재 shadow 데이터 자산이며 실제 질문 Generator에는 아직 연결하지 않습니다.';
  v_new text := '공개 웹 근거는 첫 질문 생성 시 서버에서 확인되며, 확인된 서비스만 측정시장 구성에 반영합니다.';
begin
  select pg_get_functiondef('public.resolve_measurement_market_profile_candidate_v02(uuid)'::regprocedure)
    into v_def;

  if position(v_old in v_def) = 0 then
    raise exception 'EXPECTED_LIMITATION_TEXT_NOT_FOUND';
  end if;

  v_def := replace(v_def, v_old, v_new);
  execute v_def;
end;
$migration$;
