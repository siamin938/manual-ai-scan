
alter table public.internal_observation_discovery_candidates
  drop constraint if exists internal_observation_discovery_candidate_discovery_source_check;

alter table public.internal_observation_discovery_candidates
  add constraint internal_observation_discovery_candidate_discovery_source_check
  check (discovery_source in ('web_preview','scheduled_web','manual','work'));
