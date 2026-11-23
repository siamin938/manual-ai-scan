-- Remove the legacy measurement-credit admin overview from direct signed-in RPC access.
-- The current app uses get_measurement_credit_admin_overview_v02.
-- Keep service_role access for rollback/internal operations.

revoke execute on function public.get_measurement_credit_admin_overview_v01(integer)
from authenticated;

grant execute on function public.get_measurement_credit_admin_overview_v01(integer)
to service_role;
