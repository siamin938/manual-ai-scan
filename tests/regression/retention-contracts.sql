-- Run only in the disposable CI service, after the actual retention migration and comparison RPC.
create function pg_temp.check_true(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL: %',label; end if; end; $$;
insert into organizations values ('00000000-0000-4000-8000-000000000001'),('00000000-0000-4000-8000-000000000002');
insert into measurement_runs
select ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 '00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000020',
 array['openai'],1,'live','audit','standalone','completed',null,now()+n*interval '1 hour',now()
from generate_series(101,102) n;
insert into measurement_jobs
select ('00000000-0000-4000-8000-'||lpad((n*10+q)::text,12,'0'))::uuid,
 '00000000-0000-4000-8000-000000000001',('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 ('00000000-0000-4000-8000-'||lpad(q::text,12,'0'))::uuid,'openai','fixture-model',1
from generate_series(101,102) n cross join generate_series(1,2) q;
insert into measurements select id,org_id,run_id,'fixture-parser' from measurement_jobs;
insert into provider_payloads(job_id,org_id,request_payload_redacted,response_payload,created_at,expires_at)
select id,org_id,jsonb_build_object('question',question_id),'{}',now()-interval '30 days',now()-interval '23 days' from measurement_jobs;
create function pg_temp.compatible_count() returns bigint language sql as $$
 select count(*) from get_compatible_audit_runs_v01('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000010',6);
$$;
select pg_temp.check_true((select count(*)=4 from provider_payloads where expires_at='infinity'),'old worker expiry becomes permanent');
select pg_temp.check_true((select count(*)=0 from provider_payloads where expires_at<now()+interval '10 years'),'no expiry after seven days or ten years');
select pg_temp.check_true(purge_expired_provider_payloads()=0,'legacy purge deletes nothing');
select pg_temp.check_true((select count(*)=4 from provider_payloads),'raw evidence preserved');
select pg_temp.check_true(pg_temp.compatible_count()=2,'matching complete runs compare');
select pg_temp.check_true((select count(*)=0 from get_compatible_audit_runs_v01('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000010',6)),'organization isolation');
select pg_temp.check_true(not has_table_privilege('anon','measurement_request_contracts','SELECT') and not has_table_privilege('authenticated','measurement_request_contracts','SELECT'),'request fingerprints private');
create temp table saved_contracts as select * from measurement_request_contracts;
-- In this disposable fixture only: comparison survives raw storage changes.
delete from provider_payloads;
select pg_temp.check_true(pg_temp.compatible_count()=2,'comparison independent of raw payload storage');
delete from measurement_request_contracts where job_id='00000000-0000-4000-8000-000000001011';
select pg_temp.check_true(pg_temp.compatible_count()=1,'partial historical contract excluded');
insert into measurement_request_contracts select * from saved_contracts where job_id='00000000-0000-4000-8000-000000001011';
update measurement_jobs set provider_model='different' where id='00000000-0000-4000-8000-000000001011';
select pg_temp.check_true(pg_temp.compatible_count()=1,'same questions with different model excluded');
update measurement_jobs set provider_model='fixture-model';
update measurement_request_contracts set request_fingerprint=repeat('a',64) where job_id='00000000-0000-4000-8000-000000001011';
select pg_temp.check_true(pg_temp.compatible_count()=1,'different request fingerprint excluded');
delete from measurement_request_contracts where job_id='00000000-0000-4000-8000-000000001021';
select pg_temp.check_true(pg_temp.compatible_count()=0,'missing latest contract stays unknown');
