-- Lock a legacy source-pattern RPC that is no longer called by the customer path.
-- The function is SECURITY DEFINER and does not perform its own auth/org-membership check,
-- so it must not be directly executable by browser roles.

revoke execute on function public.get_high_visibility_source_patterns_v01(uuid, uuid)
from public, anon, authenticated;

grant execute on function public.get_high_visibility_source_patterns_v01(uuid, uuid)
to service_role;
