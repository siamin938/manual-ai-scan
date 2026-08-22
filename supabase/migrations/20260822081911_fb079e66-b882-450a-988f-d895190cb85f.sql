alter table public.insight_actions
  add constraint insight_actions_id_org_business_key
  unique (id, org_id, business_id);

alter table public.experiments
  add column if not exists source_insight_action_id uuid;

alter table public.experiments
  add constraint experiments_source_insight_action_fkey
  foreign key (source_insight_action_id, org_id, business_id)
  references public.insight_actions (id, org_id, business_id)
  on delete restrict
  on update restrict;

comment on column public.experiments.source_insight_action_id is
  'Provenance: 이 실험을 촉발한 insight_actions.id. engine_run 은 insight_actions.engine_run_id 로 추적(중복 저장 금지). 생성 후 immutable 로 취급.';

alter table public.experiments
  add column if not exists baseline_condition_snapshot jsonb,
  add column if not exists followup_condition_snapshot jsonb;

alter table public.experiments
  add constraint experiments_baseline_snapshot_is_object
  check (baseline_condition_snapshot is null
         or jsonb_typeof(baseline_condition_snapshot) = 'object');

alter table public.experiments
  add constraint experiments_followup_snapshot_is_object
  check (followup_condition_snapshot is null
         or jsonb_typeof(followup_condition_snapshot) = 'object');

comment on column public.experiments.baseline_condition_snapshot is
  '재현 조건만 저장: snapshot_version, captured_at, question_set_id, questions[{id,prompt_text,prompt_hash,language,country_code,region,city}], selected_providers[], provider_model, repetitions, search_context_size, parser_version. 원본 AI 응답/API key/시크릿 저장 금지.';
comment on column public.experiments.followup_condition_snapshot is
  'baseline_condition_snapshot 과 동일 스키마. Before/After 동일 조건 검증용.';

alter table public.experiments
  add column if not exists intervention_evidence jsonb,
  add column if not exists changed_by uuid,
  add column if not exists intervention_confirmed_at timestamptz;

alter table public.experiments
  add constraint experiments_changed_by_fkey
  foreign key (changed_by) references auth.users (id) on delete set null;

alter table public.experiments
  add constraint experiments_intervention_evidence_is_array
  check (intervention_evidence is null
         or jsonb_typeof(intervention_evidence) = 'array');

comment on column public.experiments.intervention_evidence is
  'JSON array. 예: [{"type":"url","url":"...","note":"..."}]. 시크릿/개인정보 저장 금지.';

alter table public.experiments
  add column if not exists primary_metric text,
  add column if not exists baseline_value numeric,
  add column if not exists followup_value numeric,
  add column if not exists delta_value numeric,
  add column if not exists result_classification text,
  add column if not exists evidence_grade text,
  add column if not exists evaluation_version text,
  add column if not exists evaluated_at timestamptz;

alter table public.experiments
  add constraint experiments_result_classification_check
  check (result_classification is null or result_classification in (
    'improved_signal','worsened_signal','no_clear_change','mixed_signal','inconclusive'));

alter table public.experiments
  add constraint experiments_evidence_grade_check
  check (evidence_grade is null or evidence_grade in (
    'insufficient','directional','supported','strong'));

comment on column public.experiments.baseline_value is
  '평상시에는 experiment_effects 뷰의 실시간 계산값 사용. completed 확정 시에만 스냅샷 저장(원본 Run 소실 대비).';
comment on column public.experiments.evidence_grade is
  'insight_actions.evidence_grade 와 동일 체계: insufficient|directional|supported|strong.';

create index if not exists experiments_source_insight_action_idx
  on public.experiments (source_insight_action_id)
  where source_insight_action_id is not null;

create index if not exists measurement_runs_experiment_phase_idx
  on public.measurement_runs (experiment_id, phase)
  where experiment_id is not null;

revoke delete on public.experiments from authenticated;