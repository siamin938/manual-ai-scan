CREATE UNIQUE INDEX experiments_active_source_action_uidx
  ON public.experiments (org_id, source_insight_action_id)
  WHERE source_insight_action_id IS NOT NULL
    AND status IN ('draft', 'baseline', 'action_applied', 'followup');

CREATE FUNCTION public.enforce_experiment_provenance_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.source_insight_action_id IS NOT NULL THEN
    IF NEW.source_insight_action_id IS DISTINCT FROM OLD.source_insight_action_id
       OR NEW.org_id IS DISTINCT FROM OLD.org_id
       OR NEW.business_id IS DISTINCT FROM OLD.business_id THEN
      RAISE EXCEPTION 'Experiment provenance (source_insight_action_id, org_id, business_id) is immutable once linked to an insight action';
    END IF;
  ELSIF NEW.source_insight_action_id IS NOT NULL THEN
    IF NEW.org_id IS DISTINCT FROM OLD.org_id
       OR NEW.business_id IS DISTINCT FROM OLD.business_id THEN
      RAISE EXCEPTION 'Cannot change org_id or business_id while linking an experiment to an insight action';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_experiments_provenance_immutable
  BEFORE UPDATE OF source_insight_action_id, org_id, business_id
  ON public.experiments
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_experiment_provenance_immutable();