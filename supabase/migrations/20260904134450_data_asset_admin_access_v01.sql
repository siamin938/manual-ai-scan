create or replace function public.can_view_data_asset_admin_v01()
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select auth.uid() is not null
    and exists (
      select 1
      from public.organization_members om
      join public.organizations o on o.id=om.org_id
      where om.user_id=auth.uid()
        and om.role='owner'::public.app_role
        and o.measurement_data_origin='internal_observation'
    );
$function$;

revoke all on function public.can_view_data_asset_admin_v01() from public;
grant execute on function public.can_view_data_asset_admin_v01() to authenticated;
