-- Prevent signed-in customer owners/admins from promoting themselves into
-- internal platform operators or changing API budget controls from the browser.
--
-- Organization creation already uses the JWT-protected
-- create-organization-with-owner Edge Function and the service-role-only
-- create_organization_with_owner_server_v01 RPC.

revoke insert, update, truncate, trigger, references
  on table public.organizations
  from authenticated;

-- Ordinary organization profile edits remain available under the existing RLS
-- owner/admin policy. System-owned fields stay service-role / migration only.
grant update (name, timezone)
  on table public.organizations
  to authenticated;
