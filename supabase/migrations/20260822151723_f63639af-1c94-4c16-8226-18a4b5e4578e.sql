alter table public.experiments
  add column if not exists evaluation_snapshot jsonb,
  add column if not exists evaluated_by uuid references auth.users(id);

alter table public.experiments
  drop constraint if exists experiments_evaluation_snapshot_is_object;
alter table public.experiments
  add constraint experiments_evaluation_snapshot_is_object
  check (evaluation_snapshot is null or jsonb_typeof(evaluation_snapshot) = 'object');

alter table public.experiments
  drop constraint if exists experiments_evaluation_complete;
alter table public.experiments
  add constraint experiments_evaluation_complete
  check (
    (evaluation_snapshot is null and evaluated_at is null and evaluated_by is null)
    or (evaluation_snapshot is not null and evaluated_at is not null and evaluated_by is not null)
  );