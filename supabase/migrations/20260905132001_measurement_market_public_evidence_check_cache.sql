create table if not exists public.measurement_market_public_evidence_checks (
  business_identity_key text primary key,
  candidate_signature text not null,
  status text not null check (status in ('completed','no_evidence','failed')),
  checked_at timestamptz not null default now(),
  source_count integer not null default 0 check (source_count >= 0),
  accepted_evidence_count integer not null default 0 check (accepted_evidence_count >= 0),
  created_at timestamptz not null default now()
);

alter table public.measurement_market_public_evidence_checks enable row level security;
revoke all on table public.measurement_market_public_evidence_checks from public, anon, authenticated;
grant select, insert, update, delete on table public.measurement_market_public_evidence_checks to service_role;
