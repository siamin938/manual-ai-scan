-- Final cutover: organization creation now flows through
-- create-organization-with-owner Edge -> service-role-only RPC.
revoke execute on function public.create_organization_with_owner(text,text) from public, anon, authenticated;
grant execute on function public.create_organization_with_owner(text,text) to service_role;
