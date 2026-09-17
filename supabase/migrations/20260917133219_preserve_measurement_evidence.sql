-- Preserve measurement evidence indefinitely. User-authorized retention policy.
-- Existing job/organization deletion semantics are unchanged.
alter table public.provider_payloads alter column expires_at set default 'infinity'::timestamptz;

create table public.measurement_request_contracts (
  job_id uuid primary key references public.measurement_jobs(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  request_fingerprint text not null check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  captured_at timestamptz not null default now()
);
alter table public.measurement_request_contracts enable row level security;
revoke all on public.measurement_request_contracts from public, anon, authenticated;
grant select, insert, update on public.measurement_request_contracts to service_role;
create index measurement_request_contracts_org_idx on public.measurement_request_contracts(org_id);
comment on table public.measurement_request_contracts is 'Private durable request fingerprints for audit comparability. Never infer missing historical requests.';

create function public.preserve_provider_payload_evidence()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.expires_at := 'infinity'::timestamptz;
  insert into public.measurement_request_contracts(job_id, org_id, request_fingerprint)
  values (new.job_id, new.org_id, encode(sha256(convert_to(new.request_payload_redacted::text, 'UTF8')), 'hex'))
  on conflict (job_id) do update
    set request_fingerprint = excluded.request_fingerprint,
        captured_at = now()
    where measurement_request_contracts.org_id = excluded.org_id;
  return new;
end;
$$;
revoke all on function public.preserve_provider_payload_evidence() from public, anon, authenticated;
create trigger provider_payloads_preserve_evidence
before insert or update on public.provider_payloads
for each row execute function public.preserve_provider_payload_evidence();

-- This also captures real requests still present. Missing requests stay unknown.
update public.provider_payloads set expires_at = 'infinity'::timestamptz;

create or replace function public.purge_expired_provider_payloads()
returns bigint language plpgsql security definer set search_path = '' as $$
begin
  -- Kept as a no-op for compatibility with older scheduled Edge callers.
  return 0;
end;
$$;
comment on function public.purge_expired_provider_payloads() is 'Automatic evidence deletion disabled by permanent retention policy (2026-09-17).';
select cron.alter_job(job_id := jobid, active := false)
from cron.job where jobname = 'ai-visibility-purge-raw-payloads' and active;

