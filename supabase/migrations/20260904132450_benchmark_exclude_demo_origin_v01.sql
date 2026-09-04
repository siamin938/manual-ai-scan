do $$
declare
  v_oid oid;
  v_def text;
  v_old text := E'and r.experiment_id is null\n    and coalesce(r.completed_at, r.created_at) >= now() - make_interval(days => p.window_days)';
  v_new text := E'and r.experiment_id is null\n    and r.data_origin in (''internal_observation'',''customer_measurement'')\n    and coalesce(r.completed_at, r.created_at) >= now() - make_interval(days => p.window_days)';
begin
  select to_regprocedure('public.get_global_high_visibility_source_patterns_legacy_v01(uuid,uuid)')::oid
    into v_oid;

  if v_oid is null then
    raise exception 'EXPECTED_LEGACY_BENCHMARK_FUNCTION_MISSING';
  end if;

  select pg_get_functiondef(v_oid) into v_def;

  if position('r.data_origin in' in v_def) > 0 then
    return;
  end if;

  if position(v_old in v_def) = 0 then
    raise exception 'EXPECTED_BENCHMARK_ELIGIBLE_RUNS_FRAGMENT_MISSING';
  end if;

  v_def := replace(v_def, v_old, v_new);
  execute v_def;
end $$;
