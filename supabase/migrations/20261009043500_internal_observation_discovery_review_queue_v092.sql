create table if not exists public.internal_observation_discovery_candidates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,

  review_status text not null default 'needs_review'
    check (review_status in (
      'needs_review',
      'approved',
      'rejected',
      'duplicate',
      'needs_identity_review'
    )),

  discovery_source text not null default 'web_preview'
    check (discovery_source in ('web_preview','manual','work')),

  idempotency_key text not null,
  business_name text not null,
  category text not null,
  service text not null,
  region text not null,
  city text null,
  website_url text null,
  public_profile_urls jsonb not null default '[]'::jsonb
    check (jsonb_typeof(public_profile_urls) = 'array'),
  source_evidence jsonb not null default '[]'::jsonb
    check (jsonb_typeof(source_evidence) = 'array'),
  discovery_query jsonb not null default '{}'::jsonb
    check (jsonb_typeof(discovery_query) = 'object'),

  duplicate_status text not null default 'none'
    check (duplicate_status in (
      'none',
      'existing_business_exact',
      'existing_pipeline_exact',
      'existing_domain_overlap'
    )),
  duplicate_warnings jsonb not null default '[]'::jsonb
    check (jsonb_typeof(duplicate_warnings) = 'array'),
  matched_existing_business_name text null,
  matched_pipeline_business_name text null,

  preview_generated_at timestamptz null,
  first_discovered_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),

  created_by uuid null references auth.users(id) on delete set null,
  reviewed_by uuid null references auth.users(id) on delete set null,
  reviewed_at timestamptz null,
  review_note text null,

  promoted_pipeline_item_id uuid null
    references public.internal_observation_pipeline_items(id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (org_id, idempotency_key),

  check (
    (review_status = 'needs_review' and reviewed_at is null and reviewed_by is null)
    or
    (review_status <> 'needs_review' and reviewed_at is not null and reviewed_by is not null)
  )
);

create index if not exists internal_observation_discovery_candidates_org_status_idx
  on public.internal_observation_discovery_candidates(org_id, review_status, created_at desc);

create index if not exists internal_observation_discovery_candidates_org_last_seen_idx
  on public.internal_observation_discovery_candidates(org_id, last_seen_at desc);

alter table public.internal_observation_discovery_candidates enable row level security;

revoke all on table public.internal_observation_discovery_candidates from public;
revoke all on table public.internal_observation_discovery_candidates from anon;
revoke all on table public.internal_observation_discovery_candidates from authenticated;
grant select, insert, update, delete on table public.internal_observation_discovery_candidates to service_role;

drop trigger if exists set_internal_observation_discovery_candidates_updated_at
  on public.internal_observation_discovery_candidates;

create trigger set_internal_observation_discovery_candidates_updated_at
before update on public.internal_observation_discovery_candidates
for each row execute function public.set_updated_at();

comment on table public.internal_observation_discovery_candidates is
  'v0.9.2 internal automotive discovery review queue. Separate from measurement pipeline; no automatic promotion or measurement side effects.';
comment on column public.internal_observation_discovery_candidates.promoted_pipeline_item_id is
  'Reserved for v0.9.3 guarded promotion. v0.9.2 must leave this null.';
