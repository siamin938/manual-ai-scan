-- CANDIDATE ONLY — do not apply to Production without explicit approval.
-- Adds an explicit product-facing scope to measurement_runs.
-- Runtime selection must never infer this from run name or question count.

ALTER TABLE public.measurement_runs
  ADD COLUMN IF NOT EXISTS diagnostic_scope text;

ALTER TABLE public.measurement_runs
  DROP CONSTRAINT IF EXISTS measurement_runs_diagnostic_scope_check;

ALTER TABLE public.measurement_runs
  ADD CONSTRAINT measurement_runs_diagnostic_scope_check
  CHECK (diagnostic_scope IN ('customer','internal_qa'));

-- Historical rows are intentionally left NULL by the schema migration.
-- They must be classified explicitly in a separate reviewed data step.
-- This avoids silently treating old QA/smoke runs as customer diagnostics.

COMMENT ON COLUMN public.measurement_runs.diagnostic_scope IS
  'Explicit product scope for this run. customer = eligible for customer representative diagnosis; internal_qa = retained for QA/smoke validation but excluded from customer representative selection.';
