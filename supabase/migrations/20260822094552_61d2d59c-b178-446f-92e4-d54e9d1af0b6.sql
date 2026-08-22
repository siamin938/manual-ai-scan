-- =====================================================================
-- Experiment Layer v0.1 — DB Hardening
-- Migration 1: experiments audit integrity (authenticated = SELECT-only)
-- Migration 2: claim_measurement_jobs hardening (parent-run gate + run stamp)
--
-- ROLLBACK (preflight 실측 기준):
--   GRANT SELECT, INSERT, UPDATE, REFERENCES, TRIGGER, TRUNCATE, MAINTAIN
--     ON public.experiments TO authenticated;   -- DELETE는 복원하지 않음
--   CREATE POLICY experiments_write_staff ON public.experiments
--     FOR ALL TO authenticated
--     USING (has_org_role(org_id, ARRAY['owner'::app_role,'admin'::app_role,'analyst'::app_role]))
--     WITH CHECK (has_org_role(org_id, ARRAY['owner'::app_role,'admin'::app_role,'analyst'::app_role]));
--   claim_measurement_jobs: 이전 정의를 CREATE OR REPLACE로 복원
--     (parent JOIN / run_stamp CTE 없는 단일 picked CTE 버전)
--   함수 ACL 직전 실측: {postgres=X/postgres, service_role=X/postgres} (PUBLIC/anon/authenticated 없음)
-- =====================================================================

-- ---------- Migration 1 ----------
REVOKE ALL PRIVILEGES ON public.experiments FROM authenticated;
GRANT SELECT ON public.experiments TO authenticated;

DROP POLICY IF EXISTS experiments_write_staff ON public.experiments;
-- experiments_read_member (SELECT) 유지

GRANT ALL ON public.experiments TO service_role;
-- measurement_runs 권한 무변경

-- ---------- Migration 2 ----------
CREATE OR REPLACE FUNCTION public.claim_measurement_jobs(p_limit integer DEFAULT 3)
 RETURNS SETOF public.measurement_jobs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  -- [보존] 재시도 소진된 stale processing job은 failed 처리
  update public.measurement_jobs
     set status = 'failed',
         completed_at = now(),
         error_code = coalesce(error_code, 'STALE_JOB_EXHAUSTED'),
         error_message = coalesce(error_message, '처리 중단 후 최대 재시도 횟수를 초과했습니다.'),
         updated_at = now()
   where status = 'processing'
     and locked_at < now() - interval '10 minutes'
     and attempt_count >= 3;

  return query
  with picked as (
    select j.id
      from public.measurement_jobs j
      -- [추가 A] parent run이 queued/running일 때만 claim 후보
      join public.measurement_runs r
        on r.id = j.run_id
       and r.status in ('queued', 'running')
     where (
       (j.status = 'queued' and j.next_attempt_at <= now() and j.scheduled_at <= now())
       or
       (j.status = 'processing' and j.locked_at < now() - interval '10 minutes' and j.attempt_count < 3)
     )
     order by j.scheduled_at, j.created_at
     for update of j skip locked
     limit greatest(1, least(coalesce(p_limit, 3), 10))
  ),
  claimed as (
    update public.measurement_jobs j
       set status = 'processing',
           attempt_count = j.attempt_count + 1,
           started_at = coalesce(j.started_at, now()),
           locked_at = now(),
           error_code = null,
           error_message = null,
           updated_at = now()
      from picked
     where j.id = picked.id
    returning j.*
  ),
  -- [추가 B] 실제 claim된 run만 running 스탬프. 이미 running이면 started_at 유지.
  run_stamp as (
    update public.measurement_runs r
       set status = 'running',
           started_at = coalesce(r.started_at, now()),
           updated_at = now()
     where r.id in (select distinct c.run_id from claimed c)
       and r.status in ('queued', 'running')
    returning r.id
  )
  select c.* from claimed c
   where (select count(*) from run_stamp) >= 0;
end;
$function$;

-- 함수 실행 권한: worker/service_role 전용
REVOKE ALL ON FUNCTION public.claim_measurement_jobs(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_measurement_jobs(integer) FROM anon;
REVOKE ALL ON FUNCTION public.claim_measurement_jobs(integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_measurement_jobs(integer) TO service_role;