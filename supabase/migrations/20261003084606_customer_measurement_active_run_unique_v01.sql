-- Prevent duplicate active customer measurements for the same business/question set.
-- Scope is intentionally limited to customer standalone audit runs that are still active.
-- Completed/partial/failed/cancelled history remains unrestricted.

create unique index measurement_runs_customer_active_condition_uq
on public.measurement_runs (org_id, business_id, question_set_id)
where run_type = 'audit'::public.run_type
  and phase = 'standalone'::public.run_phase
  and diagnostic_scope = 'customer'
  and experiment_id is null
  and status in (
    'draft'::public.run_status,
    'queued'::public.run_status,
    'running'::public.run_status
  );
