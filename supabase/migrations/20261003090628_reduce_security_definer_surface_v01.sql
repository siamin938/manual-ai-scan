-- Reduce unnecessary SECURITY DEFINER surface.
-- Both functions already rely on caller auth context/RLS and do not require definer privileges.

alter function public.can_view_data_asset_admin_v01() security invoker;
alter function public.get_org_usage(uuid) security invoker;
