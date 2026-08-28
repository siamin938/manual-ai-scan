-- Repo sync for the citation-attribution trigger already applied in production.
-- Idempotent: create or replace function / drop trigger if exists / create trigger.
--
-- Fires right after a `visibility_postprocess_completed` event is inserted into
-- public.system_events and calls the Supabase `visibility-citation-attribution`
-- Edge Function through net.http_post. The active postprocess token is read
-- inside the database only; it is never hardcoded or logged.

CREATE OR REPLACE FUNCTION public.trigger_visibility_citation_attribution_after_postprocess()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_token text;
  v_request_id bigint;
  v_attribution_version constant text := '0.1.0';
begin
  if new.event_type <> 'visibility_postprocess_completed' then
    return new;
  end if;

  if new.run_id is null then
    return new;
  end if;

  -- Already attributed for this run at the current attribution version.
  if exists (
    select 1
    from public.system_events se
    where se.org_id = new.org_id
      and se.run_id = new.run_id
      and se.event_type = 'visibility_citation_attribution_completed'
      and se.metadata->>'attribution_version' = v_attribution_version
  ) then
    return new;
  end if;

  select token into v_token
  from public.visibility_postprocess_tokens
  where active = true
  order by created_at asc
  limit 1;

  if v_token is null then
    insert into public.system_events(org_id, run_id, event_type, severity, message, metadata)
    values (
      new.org_id,
      new.run_id,
      'visibility_citation_attribution_trigger_failed',
      'error',
      'Citation attribution trigger token unavailable.',
      jsonb_build_object('attribution_version', v_attribution_version, 'error_code', 'TOKEN_UNAVAILABLE')
    );
    return new;
  end if;

  select net.http_post(
    url := 'https://qoirkwmnyolquvsgbian.supabase.co/functions/v1/visibility-citation-attribution',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-visibility-postprocess-token', v_token
    ),
    body := jsonb_build_object('runId', new.run_id::text)
  ) into v_request_id;

  insert into public.system_events(org_id, run_id, event_type, severity, message, metadata)
  values (
    new.org_id,
    new.run_id,
    'visibility_citation_attribution_triggered',
    'info',
    'Citation attribution queued after visibility postprocess completion.',
    jsonb_build_object('attribution_version', v_attribution_version, 'request_id', v_request_id)
  );

  return new;
end;
$$;

DROP TRIGGER IF EXISTS trg_visibility_citation_attribution_after_postprocess ON public.system_events;

CREATE TRIGGER trg_visibility_citation_attribution_after_postprocess
AFTER INSERT ON public.system_events
FOR EACH ROW
WHEN (NEW.event_type = 'visibility_postprocess_completed')
EXECUTE FUNCTION public.trigger_visibility_citation_attribution_after_postprocess();
