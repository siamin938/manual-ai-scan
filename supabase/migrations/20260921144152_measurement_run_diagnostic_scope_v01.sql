-- Applied to Production after explicit approval on 2026-09-21.
-- Adds an explicit product-facing scope to measurement_runs.
-- Runtime selection must never infer this from run name or question count.

ALTER TABLE public.measurement_runs
  ADD COLUMN IF NOT EXISTS diagnostic_scope text NOT NULL DEFAULT 'customer';

ALTER TABLE public.measurement_runs
  DROP CONSTRAINT IF EXISTS measurement_runs_diagnostic_scope_check;

ALTER TABLE public.measurement_runs
  ADD CONSTRAINT measurement_runs_diagnostic_scope_check
  CHECK (diagnostic_scope IN ('customer','internal_qa'));

-- Backward-compatible default is customer. Reviewed historical QA/smoke runs
-- must be reclassified explicitly in a separate approved data step before the
-- customer-facing Gateway filter is deployed. Runtime never infers scope from
-- run name, question count, or timestamps.

COMMENT ON COLUMN public.measurement_runs.diagnostic_scope IS
  'Explicit product scope for this run. customer = eligible for customer representative diagnosis; internal_qa = retained for QA/smoke validation but excluded from customer representative selection.';
