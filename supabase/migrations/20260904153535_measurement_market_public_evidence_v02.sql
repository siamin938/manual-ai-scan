-- Shadow-only market profile v0.2. Live question generation remains unchanged.
create table if not exists public.measurement_market_public_evidence (
  id uuid primary key default gen_random_uuid(),
  business_identity_key text not null,
  service_key text not null,
  source_url text not null,
  source_domain text not null,
  source_title text,
  source_type text not null default 'public_web',
  evidence_strength text not null default 'supporting',
  evidence_note text,
  observed_at timestamptz not null default now(),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint measurement_market_public_evidence_strength_ck check (evidence_strength in ('supporting','strong'))
);
create unique index if not exists measurement_market_public_evidence_uq on public.measurement_market_public_evidence(business_identity_key, service_key, source_url);
create index if not exists measurement_market_public_evidence_identity_idx on public.measurement_market_public_evidence(business_identity_key, active, service_key);
alter table public.measurement_market_public_evidence enable row level security;
revoke all on table public.measurement_market_public_evidence from public;
grant select, insert, update, delete on table public.measurement_market_public_evidence to service_role;

-- Full function body is applied in production Supabase migration version 20260904153535.
-- Repository migration history for this date is intentionally synchronized as a traceable marker.
