-- Repo sync for the citation-attribution trigger already applied in production.
-- Idempotent: safe to re-apply.
--
-- Fires only right after a `visibility_postprocess_completed` event is inserted
-- into public.system_events. Skips when the same run already has a
-- `visibility_citation_attribution_completed` event with
-- metadata.attribution_version = '0.1.0'.
-- The active postprocess token is read server-side only and is never logged
-- or hardcoded.

CREATE OR REPLACE FUNCTION public.trigger_visibility_citation_attribution()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_token text;
  v_url text := 'https://qoirkwmnyolquvsgbian.supabase.co/functions/v1/visibility-citation-attribution';
BEGIN
  IF NEW.event_type IS DISTINCT FROM 'visibility_postprocess_completed' THEN
    RETURN NEW;
  END IF;

  IF NEW.run_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Already attributed for this run at the current attribution version.
  IF EXISTS (
    SELECT 1
    FROM public.system_events se
    WHERE se.run_id = NEW.run_id
      AND se.event_type = 'visibility_citation_attribution_completed'
      AND se.metadata->>'attribution_version' = '0.1.0'
  ) THEN
    RETURN NEW;
  END IF;

  SELECT t.token
    INTO v_token
  FROM public.visibility_postprocess_tokens t
  WHERE t.active
  ORDER BY t.created_at DESC
  LIMIT 1;

  IF v_token IS NULL THEN
    INSERT INTO public.system_events (org_id, run_id, event_type, severity, message, metadata)
    VALUES (
      NEW.org_id,
      NEW.run_id,
      'visibility_citation_attribution_skipped',
      'warning',
      'No active postprocess token; citation attribution was not requested.',
      jsonb_build_object('attribution_version', '0.1.0')
    );
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-postprocess-token', v_token
    ),
    body := jsonb_build_object('run_id', NEW.run_id)
  );

  INSERT INTO public.system_events (org_id, run_id, event_type, severity, message, metadata)
  VALUES (
    NEW.org_id,
    NEW.run_id,
    'visibility_citation_attribution_triggered',
    'info',
    'Citation attribution requested for the completed postprocess run.',
    jsonb_build_object('attribution_version', '0.1.0')
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_visibility_citation_attribution_after_postprocess ON public.system_events;

CREATE TRIGGER trigger_visibility_citation_attribution_after_postprocess
AFTER INSERT ON public.system_events
FOR EACH ROW
WHEN (NEW.event_type = 'visibility_postprocess_completed')
EXECUTE FUNCTION public.trigger_visibility_citation_attribution();
