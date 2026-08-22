ALTER TABLE public.experiments
  ADD COLUMN IF NOT EXISTS action_application_snapshot jsonb;

ALTER TABLE public.experiments
  DROP CONSTRAINT IF EXISTS experiments_action_snapshot_is_object;
ALTER TABLE public.experiments
  ADD CONSTRAINT experiments_action_snapshot_is_object
  CHECK (action_application_snapshot IS NULL OR jsonb_typeof(action_application_snapshot) = 'object');

ALTER TABLE public.experiments
  DROP CONSTRAINT IF EXISTS experiments_action_applied_complete;
ALTER TABLE public.experiments
  ADD CONSTRAINT experiments_action_applied_complete
  CHECK (
    status <> 'action_applied'::public.experiment_status
    OR (
      intervention_at IS NOT NULL
      AND intervention_confirmed_at IS NOT NULL
      AND changed_by IS NOT NULL
      AND action_application_snapshot IS NOT NULL
    )
  );

COMMENT ON COLUMN public.experiments.action_application_snapshot IS
  'Action Applied audit snapshot v1 (server-generated). No secrets, no raw provider responses, no baseline parsing_context copy.';