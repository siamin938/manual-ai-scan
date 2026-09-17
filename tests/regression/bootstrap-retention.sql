-- Disposable PostgreSQL CI database only. Never run this bootstrap on a project.
create role anon;
create role authenticated;
create role service_role;
create type public.run_type as enum ('audit','experiment');
create type public.run_phase as enum ('standalone','baseline','followup');
create type public.run_status as enum ('completed','running');
create table public.organizations(id uuid primary key);
create table public.measurement_runs (
 id uuid primary key,org_id uuid,business_id uuid,question_set_id uuid,
 selected_providers text[],repetitions integer,data_origin text,
 run_type public.run_type,phase public.run_phase,status public.run_status,
 experiment_id uuid,completed_at timestamptz,created_at timestamptz
);
create table public.measurement_jobs(id uuid primary key,org_id uuid,run_id uuid,question_id uuid,provider text,provider_model text,repetition_no int);
create table public.measurements(id uuid primary key,org_id uuid,run_id uuid,parser_version text);
create table public.provider_payloads (
 job_id uuid primary key references public.measurement_jobs(id), org_id uuid references public.organizations(id),
 request_payload_redacted jsonb not null,response_payload jsonb not null,
 expires_at timestamptz not null,created_at timestamptz not null default now()
);
create schema cron;
create table cron.job(jobid bigint,jobname text,active boolean);
insert into cron.job values(1,'ai-visibility-purge-raw-payloads',true);
create function cron.alter_job(job_id bigint,active boolean) returns void language sql as $$
 update cron.job set active=$2 where jobid=$1;
$$;
