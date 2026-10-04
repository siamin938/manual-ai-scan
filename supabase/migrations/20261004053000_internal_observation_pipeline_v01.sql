create table if not exists public.internal_observation_pipeline_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  idempotency_key text not null,
  status text not null default 'pending'
    check (status in (
      'pending',
      'preparing',
      'ready_to_measure',
      'blocked',
      'failed',
      'measuring',
      'completed',
      'cancelled'
    )),
  business_name text not null check (char_length(btrim(business_name)) between 1 and 200),
  aliases text[] not null default '{}'::text[],
  category text not null default '',
  region text not null,
  city text,
  address text,
  website_url text,
  naver_place_url text,
  google_maps_url text,
  service text not null,
  brand_model text,
  customer_need text,
  source_label text,
  business_id uuid references public.businesses(id) on delete set null,
  question_set_id uuid references public.question_sets(id) on delete set null,
  run_id uuid references public.measurement_runs(id) on delete set null,
  readiness jsonb not null default '{}'::jsonb,
  error_code text,
  error_message text,
  prepared_at timestamptz,
  measurement_approved_at timestamptz,
  measurement_approved_by uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(org_id, idempotency_key)
);

create index if not exists internal_observation_pipeline_items_org_status_idx
  on public.internal_observation_pipeline_items(org_id, status, created_at desc);

create index if not exists internal_observation_pipeline_items_business_idx
  on public.internal_observation_pipeline_items(business_id)
  where business_id is not null;

create table if not exists public.internal_observation_pipeline_settings (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  execution_enabled boolean not null default false,
  daily_run_limit smallint not null default 5 check (daily_run_limit between 1 and 100),
  concurrent_run_limit smallint not null default 1 check (concurrent_run_limit between 1 and 10),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.internal_observation_pipeline_items enable row level security;
alter table public.internal_observation_pipeline_settings enable row level security;

revoke all on table public.internal_observation_pipeline_items from public, anon, authenticated;
revoke all on table public.internal_observation_pipeline_settings from public, anon, authenticated;

grant all on table public.internal_observation_pipeline_items to service_role;
grant all on table public.internal_observation_pipeline_settings to service_role;

comment on table public.internal_observation_pipeline_items is
'Internal CHABOIM observation pipeline queue. Service-role only; operator access is mediated by authenticated server functions gated by can_view_data_asset_admin_v01().';

comment on table public.internal_observation_pipeline_settings is
'Per-internal-observation-org execution guardrails. execution_enabled defaults false so implementation cannot start measurements until explicitly enabled.';
