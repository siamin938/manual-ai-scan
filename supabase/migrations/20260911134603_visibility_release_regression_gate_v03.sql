-- Historical migration preserved to keep GitHub migration versions aligned with production.
-- This first v0.3 draft was replaced minutes later by the optimized/split variants below.
-- The final effective definition is in 20260911135344_visibility_release_regression_gate_v03_split.sql.

create or replace function public.get_visibility_release_regression_v03()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $function$
with base as (
  select public.get_visibility_release_regression_v02() as result
)
select jsonb_build_object(
  'version','0.3',
  'mode','shadow',
  'ok',coalesce((base.result->>'ok')::boolean,false),
  'checks',coalesce(base.result->'checks','[]'::jsonb)
)
from base;
$function$;

revoke all on function public.get_visibility_release_regression_v03() from public, anon, authenticated;
grant execute on function public.get_visibility_release_regression_v03() to service_role;
