alter table public.internal_observation_discovery_candidates
  add column if not exists promoted_at timestamptz null,
  add column if not exists promoted_by uuid null references auth.users(id) on delete set null;

create unique index if not exists internal_observation_discovery_candidates_promoted_pipeline_unique
  on public.internal_observation_discovery_candidates(promoted_pipeline_item_id)
  where promoted_pipeline_item_id is not null;

alter table public.internal_observation_discovery_candidates
  drop constraint if exists internal_observation_discovery_candidates_promotion_metadata_check;

alter table public.internal_observation_discovery_candidates
  add constraint internal_observation_discovery_candidates_promotion_metadata_check
  check (
    (
      promoted_pipeline_item_id is null
      and promoted_at is null
      and promoted_by is null
    )
    or
    (
      promoted_pipeline_item_id is not null
      and promoted_at is not null
      and promoted_by is not null
      and review_status='approved'
    )
  );

comment on column public.internal_observation_discovery_candidates.promoted_at is
  'v0.9.3 guarded-promotion completion time. Null before explicit promotion.';
comment on column public.internal_observation_discovery_candidates.promoted_by is
  'Operator who explicitly confirmed v0.9.3 guarded promotion.';
