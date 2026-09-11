create or replace function public.create_organization_with_owner_server_v01(
  p_user_id uuid,
  p_name text,
  p_slug text
)
returns uuid
language plpgsql
security definer
set search_path = 'public'
as $function$
declare
  v_org_id uuid;
  v_slug text := lower(trim(p_slug));
begin
  if p_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not exists (select 1 from auth.users u where u.id = p_user_id) then
    raise exception 'USER_NOT_FOUND';
  end if;

  if exists (
    select 1 from public.organization_members m where m.user_id = p_user_id
  ) then
    raise exception 'ALREADY_HAS_ORGANIZATION';
  end if;

  if char_length(trim(coalesce(p_name,''))) < 2 then
    raise exception 'INVALID_ORGANIZATION_NAME';
  end if;

  if v_slug !~ '^[a-z0-9][a-z0-9-]{1,62}$' then
    raise exception 'INVALID_SLUG';
  end if;

  insert into public.organizations (name, slug)
  values (trim(p_name), v_slug)
  returning id into v_org_id;

  insert into public.organization_members (org_id, user_id, role)
  values (v_org_id, p_user_id, 'owner');

  insert into public.provider_settings (
    org_id, provider, enabled, model_name, search_context_size,
    estimated_cost_per_request_usd, paid_account_confirmed,
    terms_reviewed, terms_version, terms_reviewed_at,
    automated_benchmark_approved, approval_reference, config
  ) values (
    v_org_id,
    'openai',
    true,
    'gpt-5.6-luna',
    'low',
    0.05,
    true,
    true,
    'OpenAI Services Agreement updated 2025-12-01, effective 2026-01-01; API Data Controls reviewed 2026-08-17',
    '2026-08-17 14:02:50.113968+00'::timestamptz,
    true,
    'Owner-approved internal MVP 2026-08-17: Responses API web_search benchmark; public questions and public location only; store=false; no consumer UI scraping; internal monthly budget USD 1',
    jsonb_build_object(
      'store', false,
      'data_policy', 'public_questions_only',
      'reviewed_on', '2026-08-17',
      'review_scope', 'OpenAI Responses API web_search benchmark',
      'consumer_ui_scraping', false
    )
  ),(
    v_org_id, 'gemini', false, 'gemini-3.6-flash', 'low', 0.05,
    false, false, null, null, false, null, '{}'::jsonb
  ),(
    v_org_id, 'perplexity', false, 'preset:low', 'low', 0.05,
    false, false, null, null, false, null, '{}'::jsonb
  );

  insert into public.measurement_credit_accounts(org_id)
  values (v_org_id)
  on conflict (org_id) do nothing;

  return v_org_id;
exception
  when unique_violation then
    raise exception 'SLUG_ALREADY_EXISTS';
end;
$function$;

revoke all on function public.create_organization_with_owner_server_v01(uuid,text,text) from public, anon, authenticated;
grant execute on function public.create_organization_with_owner_server_v01(uuid,text,text) to service_role;
