revoke execute on function public.get_measurement_market_feature_flag_v01(uuid) from public, anon, authenticated;
revoke execute on function public.build_measurement_market_portfolio_candidate_v01(uuid) from public, anon, authenticated;
revoke execute on function public.build_measurement_market_portfolio_candidate_v02(uuid) from public, anon, authenticated;
revoke execute on function public.resolve_measurement_market_profile_candidate_v01(uuid) from public, anon, authenticated;
revoke execute on function public.resolve_measurement_market_profile_candidate_v02(uuid) from public, anon, authenticated;
revoke execute on function public.preview_measurement_market_questions_candidate_v02(uuid) from public, anon, authenticated;
revoke execute on function public.consume_measurement_market_shadow_nonce_v01(text, uuid, uuid) from public, anon, authenticated;

grant execute on function public.get_measurement_market_feature_flag_v01(uuid) to service_role;
grant execute on function public.build_measurement_market_portfolio_candidate_v01(uuid) to service_role;
grant execute on function public.build_measurement_market_portfolio_candidate_v02(uuid) to service_role;
grant execute on function public.resolve_measurement_market_profile_candidate_v01(uuid) to service_role;
grant execute on function public.resolve_measurement_market_profile_candidate_v02(uuid) to service_role;
grant execute on function public.preview_measurement_market_questions_candidate_v02(uuid) to service_role;
grant execute on function public.consume_measurement_market_shadow_nonce_v01(text, uuid, uuid) to service_role;
