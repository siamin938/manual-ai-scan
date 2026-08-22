# Experiments 소스 계보 확장 설계 (Profile Coverage Action 지원)

READ ONLY 점검 결과 기반 설계안입니다. 이번 단계에서는 아무것도 실행하지 않습니다.

## 1. 현재 스키마 확인 결과 (실측)

`public.experiments` (37 컬럼) 중 계보 관련:

- `org_id uuid NOT NULL`, `business_id uuid NOT NULL`
- `source_insight_action_id uuid NULL` (nullable)
- 제약조건
  - PK: `experiments_pkey (id)`
  - FK 복합: `experiments_source_insight_action_fkey (source_insight_action_id, org_id, business_id) -> insight_actions(id, org_id, business_id) ON UPDATE RESTRICT ON DELETE RESTRICT`
  - FK: org/business/baseline_run/followup_run/created_by/changed_by/evaluated_by
  - CHECK: action_applied 완결성, evaluation 완결성, jsonb 타입, evidence_grade, result_classification
- 인덱스
  - `experiments_org_business_idx (org_id, business_id, status)`
  - `experiments_source_insight_action_idx (source_insight_action_id) WHERE NOT NULL`
  - `experiments_active_source_action_uidx UNIQUE (org_id, source_insight_action_id) WHERE source_insight_action_id IS NOT NULL AND status IN (draft, baseline, action_applied, followup)`
- 트리거: `enforce_experiment_provenance_immutable` — `source_insight_action_id`가 이미 있으면 org/business/source 변경 금지
- 현재 데이터: 실험 1건, status=`baseline` (현대엑스티어 판교, source_insight_action_id 보유)

`profile_coverage_items`: `id`, `org_id`, `business_id`, `coverage_run_id`, `question_id`, 지표 컬럼들.
- FK는 `coverage_run_id -> profile_coverage_runs(id) ON DELETE CASCADE` 뿐
- UNIQUE `(coverage_run_id, question_id)`, PK `(id)`
- **`(id, org_id, business_id)` 복합 UNIQUE가 없음** → experiments에서 복합 FK를 걸려면 먼저 추가 필요
- `org_id`/`business_id`에 organizations/businesses FK도 없음 (기존 설계 그대로 유지)

`insight_actions`: `(id, org_id, business_id)` UNIQUE 존재 → 기존 복합 FK가 성립.

`experiments.functions.ts` / `experiments.baseline.server.ts` 강제 계보:
- 생성: Insight Action에서만 시작. action의 mode/status 검증 → business/engine_run/primary_finding 4중 scope 검증 → `source_insight_action_id` 필수 세팅
- Baseline 준비(`experiments.baseline.server.ts:89`): `if (!experiment.source_insight_action_id) return fail(...)` → **Insight 계보가 없으면 Baseline 자체가 불가**
- Action Applied(`experiments.action.server.ts:102`)도 동일하게 `source_insight_action_id` 필수
- Evaluation/Followup은 select에 컬럼만 포함하고 값 일치 검증(evaluation.server.ts:410)에 사용

## 2. 권장 최소 변경안

### 컬럼
1. `source_type text NOT NULL DEFAULT 'insight_action'`
   - 허용값: `'insight_action' | 'profile_coverage_item'`
2. `source_profile_coverage_item_id uuid NULL`
3. (선택, 권장) `source_profile_coverage_run_id uuid NULL` — 재현성 추적용. 없어도 item에서 join 가능하므로 **이번 단계에서는 추가하지 않음**을 권장.

`source_insight_action_id`는 **nullable 유지**가 맞습니다. NOT NULL로 바꿀 수 없고(신규 소스에서는 NULL), 삭제도 불가(기존 FK/UNIQUE/트리거/코드가 전부 의존).

### CHECK (정확히 하나의 소스)
```
source_type='insight_action'        => source_insight_action_id NOT NULL AND source_profile_coverage_item_id IS NULL
source_type='profile_coverage_item' => source_profile_coverage_item_id NOT NULL AND source_insight_action_id IS NULL
```

### FK
- `profile_coverage_items`에 `UNIQUE (id, org_id, business_id)` 추가
- `experiments (source_profile_coverage_item_id, org_id, business_id) -> profile_coverage_items(id, org_id, business_id) ON UPDATE RESTRICT ON DELETE RESTRICT`
  (insight_actions 패턴과 동일. org 교차 오염 차단)

### Partial UNIQUE index
- 기존 `experiments_active_source_action_uidx`는 **그대로 유지** (하위호환)
- 신규: `UNIQUE (org_id, source_profile_coverage_item_id) WHERE source_profile_coverage_item_id IS NOT NULL AND status IN (draft, baseline, action_applied, followup)`
- 조회용 partial index `(source_profile_coverage_item_id) WHERE NOT NULL`

### Backfill
- 기존 행 1건은 `source_insight_action_id`가 채워져 있고 `source_type` DEFAULT가 `'insight_action'`이므로 **backfill 불필요**. 단 DEFAULT 적용을 확실히 하려고 명시적 UPDATE 한 줄을 migration에 포함(멱등).

### 트리거
`enforce_experiment_provenance_immutable`을 확장해 `source_profile_coverage_item_id`와 `source_type`도 불변으로 취급해야 합니다. 지금은 신규 컬럼을 모르므로 나중에 값이 바뀌어도 막지 못합니다. 이번 migration에 함수 교체 포함(기존 로직 보존 + 신규 컬럼 추가 검사).

## 3. 기존 코드가 깨질 수 있는 지점

- `experiments.baseline.server.ts:89`, `experiments.action.server.ts:102`: `source_insight_action_id` NULL이면 즉시 실패 → Coverage 계보 실험은 Baseline/Action 단계 진입 불가. **migration만으로는 동작하지 않고, 후속 코드 단계에서 source_type 분기 필요**(이번 단계 범위 밖).
- `experiments.helpers.ts:207`: 스냅샷 타입이 `source_insight_action_id: string` (non-null) → Coverage 계보 지원 시 union 타입화 필요.
- `insights.functions.ts:213`: `.in("source_insight_action_id", actionIds)` → NULL 행은 자동 제외되므로 **깨지지 않음**.
- `evaluation.server.ts:410`: action 레코드와 값 일치 검증 → insight 계보에서만 실행되도록 이미 앞단에서 걸러짐, 분기 추가 필요.
- 생성된 Supabase 타입 파일은 스키마 변경 후 갱신됨 — 신규 컬럼은 optional이라 기존 insert 코드는 그대로 컴파일됩니다.

즉 이번 migration은 **순수 additive**이며 기존 Insight Experiment 흐름을 전혀 바꾸지 않습니다.

## 4. Migration SQL 초안 (실행하지 않음)

```sql
begin;

-- (A) 복합 FK 타겟 확보
alter table public.profile_coverage_items
  add constraint profile_coverage_items_id_org_business_key
  unique (id, org_id, business_id);

-- (B) 소스 계보 컬럼
alter table public.experiments
  add column if not exists source_type text not null default 'insight_action',
  add column if not exists source_profile_coverage_item_id uuid;

update public.experiments
   set source_type = 'insight_action'
 where source_insight_action_id is not null
   and source_type is distinct from 'insight_action';

-- (C) 허용값 + 정확히 하나의 소스
alter table public.experiments
  add constraint experiments_source_type_check
  check (source_type in ('insight_action', 'profile_coverage_item'));

alter table public.experiments
  add constraint experiments_single_source_check
  check (
    (source_type = 'insight_action'
      and source_insight_action_id is not null
      and source_profile_coverage_item_id is null)
    or
    (source_type = 'profile_coverage_item'
      and source_profile_coverage_item_id is not null
      and source_insight_action_id is null)
  );

-- (D) 복합 FK (org/business 교차 차단)
alter table public.experiments
  add constraint experiments_source_profile_coverage_item_fkey
  foreign key (source_profile_coverage_item_id, org_id, business_id)
  references public.profile_coverage_items (id, org_id, business_id)
  on update restrict on delete restrict;

-- (E) 인덱스
create index if not exists experiments_source_pci_idx
  on public.experiments (source_profile_coverage_item_id)
  where source_profile_coverage_item_id is not null;

create unique index if not exists experiments_active_source_pci_uidx
  on public.experiments (org_id, source_profile_coverage_item_id)
  where source_profile_coverage_item_id is not null
    and status in ('draft','baseline','action_applied','followup');

-- (F) provenance 불변 트리거 확장 (기존 로직 보존 + 신규 컬럼)
create or replace function public.enforce_experiment_provenance_immutable()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if old.source_type is distinct from new.source_type then
    raise exception 'Experiment source_type is immutable';
  end if;

  if old.source_profile_coverage_item_id is not null
     and new.source_profile_coverage_item_id is distinct from old.source_profile_coverage_item_id then
    raise exception 'Experiment source_profile_coverage_item_id is immutable';
  end if;

  if old.source_insight_action_id is not null then
    if new.source_insight_action_id is distinct from old.source_insight_action_id
       or new.org_id is distinct from old.org_id
       or new.business_id is distinct from old.business_id then
      raise exception 'Experiment provenance (source_insight_action_id, org_id, business_id) is immutable once linked to an insight action';
    end if;
  elsif new.source_insight_action_id is not null then
    if new.org_id is distinct from old.org_id
       or new.business_id is distinct from old.business_id then
      raise exception 'Cannot change org_id or business_id while linking an experiment to an insight action';
    end if;
  end if;

  if old.source_profile_coverage_item_id is not null
     and (new.org_id is distinct from old.org_id
          or new.business_id is distinct from old.business_id) then
    raise exception 'Experiment org/business is immutable once linked to a coverage item';
  end if;

  return new;
end;
$$;

commit;
```

주의: (A)의 UNIQUE 추가는 `profile_coverage_items`가 커지면 인덱스 생성 비용이 있습니다. 현재 행 수는 매우 적어 즉시 완료됩니다.

## 5. 검증 쿼리 (migration 후 READ ONLY)

```sql
select id, status, source_type, source_insight_action_id, source_profile_coverage_item_id
  from public.experiments;
```
기존 1건이 `source_type='insight_action'`, coverage id NULL, status=`baseline` 유지인지 확인.

## 6. 이번 단계 이후 (별도 승인 필요)

- `experiments.functions.ts`에 `createExperimentFromCoverageItem` 추가
- `baseline/action/evaluation` 서버 함수에 `source_type` 분기 도입
- `/profile-coverage` 액션 카드에 "실험으로 검증하기" CTA

현재 실험 `ac689395-0c73-470c-a631-5ff6a076a13d`는 어떤 단계에서도 상태 변경 대상이 아닙니다.
