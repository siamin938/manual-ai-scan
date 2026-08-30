# Entity Verification을 competitor_substitution 입력 gate로 전환 (조사 결과 + 계획)

## 1) 자동 후처리 호출 순서가 구현된 위치

`src/lib/run-postprocess.functions.ts` (server function `runPostprocess`)에 단일 오케스트레이터로 구현되어 있습니다. 순서는:

```text
reparse-measurements (Edge)
  -> entityVerification (verifyAndPersistBusinessEntities, .server.ts)
  -> sourceClassification
  -> measurementSummary
  -> compute-profile-coverage (Edge)
  -> firstPartyCoverage
  -> compute-insights (Edge)
```

단계 상태/에러 코드 정의는 `src/lib/run-postprocess.helpers.ts`, UI 자동 트리거는 `src/routes/_authenticated/runs.$runId.tsx`에 있습니다.

즉 **Entity Verification이 compute-insights보다 먼저 실행되는 순서는 이미 충족**되어 있으며, 이번 단계에서 순서 변경은 필요하지 않습니다. 단계가 실패하면 이후 단계는 skipped 처리되어 insights도 실행되지 않습니다(fail-closed).

## 2) compute-insights Edge Function 소스 접근 가능 여부

**Lovable 저장소에서 직접 읽을 수 없습니다.** 이 프로젝트에는 `supabase/functions/` 디렉터리 자체가 없고(`supabase/`에는 `config.toml`과 `migrations`만 존재), Edge Function 소스는 연결된 외부 Supabase 프로젝트에만 존재합니다. 사용 가능한 도구는 배포/호출/로그 조회뿐이라, 기존 소스를 내려받아 diff 하는 것은 불가능합니다. 전체 소스를 새로 작성해 덮어쓰는 배포는 기술적으로 가능하지만, 현재 0.2.0 로직을 알 수 없으므로 **덮어쓰기는 회귀 위험이 커서 권장하지 않습니다.**

따라서 gate 적용 방식은 아래 두 갈래이며, 이 계획은 A안을 기본으로 합니다.

- **A안 (권장): DB 레이어 gate.** 코드가 아닌 데이터/뷰 계약으로 gate를 강제하고, Edge Function은 그 계약만 읽도록 최소 패치를 사용자가 적용.
- **B안: Edge Function 전면 재작성 배포.** 소스 확보 후에만 검토.

## 3) 확인된 현재 상태 (READ ONLY)

- `public.measurement_entity_verifications` 컬럼: `org_id, business_id, measurement_id, measurement_mention_id, verifier_version, verification_status, verified_entity_kind, verified_count_as_business, confidence, reason_codes, created_at`. RLS 활성, service_role SELECT 가능.
- 현재 데이터 분포(verifier_version 0.1.0): confirmed_business/specific_business/true = 9건, needs_review = 44건, rejected_non_business = 29건.
- `insight_engine_runs.engine_version`에 존재하는 값: `0.1.1`, `0.2.0`. `0.2.1`은 아직 없음 → provenance 분리 여지 있음.

## 4) 계획

### 단계 1 — Gate 계약을 DB 뷰로 고정 (migration)

읽기 전용 뷰 `public.v_entity_verified_business_mentions`를 추가:

- 조건: `verifier_version='0.1.0' AND verification_status='confirmed_business' AND verified_entity_kind='specific_business' AND verified_count_as_business=true`
- 노출 컬럼: `org_id, business_id, measurement_id, measurement_mention_id` (텍스트/이유코드/증거 미노출)
- `security_invoker=on`, `GRANT SELECT`는 `authenticated`, `service_role`에만 부여(anon 제외).

이 뷰가 competitor_substitution의 **유일한 허용 mention 집합**입니다. verification row가 없으면 애초에 뷰에 없으므로 자동으로 fail-closed가 됩니다.

### 단계 2 — compute-insights 최소 패치 지시서 재작성 (문서만, 배포는 사용자 확인 후)

`docs/compute-insights-0.2.1-competitor-gate.md`를 **전면 교체**합니다(기존 텍스트 금지어/블랙리스트 방식 폐기 명시).

새 지시서 내용:

- `ENGINE_VERSION = "0.2.1"` (0.2.0 insight run은 그대로 보존, 재실행 시 새 run으로 분리)
- `buildCompetitorSubstitutionFindings`에서 후보 루프 진입 전, 해당 run의 measurement mention id 집합을 위 뷰에서 조회해 `Set<measurement_mention_id>` 구성
- 각 후보의 근거 mention이 그 Set에 없으면 `continue` (verification 없음/needs_review/rejected 모두 제외)
- 텍스트 패턴 기반 판정 코드는 추가하지 않음. Parser v1.2.3 입력/규칙/버전 무변경. `buildConditionCanonical` 등 해시 입력 무변경.
- 다른 finding type(생성 로직·임계값·evidence grade)은 무변경

### 단계 3 — 앱 측 정합성 보강 (선택, 같은 계약 재사용)

`src/routes/_authenticated/runs.$runId.tsx`의 자동 경쟁업체 후보 카드가 로컬 필터 대신 동일한 verification 계약을 우선 사용하도록 정리(이미 verifier 결과를 읽는 경로가 있으면 그 조건을 위 4개 컬럼 조건으로 통일). UI는 이유코드를 표시하지 않습니다.

### 단계 4 — 검증

- `bun test`, `tsgo --noEmit`, production build
- 뷰 적용 후 READ ONLY 카운트 확인: 뷰 행 수 == confirmed_business 9건
- client bundle secret scan
- **실제 compute-insights 호출/재처리, Run 실행은 하지 않음.** 사용자가 별도로 배포·실행 후 0.2.1 run 생성 여부를 확인.

## 보안 원칙 준수

- verifier 입력·gate 모두 `response_text`, aliases, Registry, 내부 Insight 로직을 사용하지 않으며 provider/AI 호출 0.
- service_role은 `.server.ts` 및 Edge Function 런타임에서만 사용, 클라이언트 노출 없음.
- 뷰/서버 함수 모두 `org_id` + `business_id` 스코프 강제, anon grant 없음 → 타 org 데이터 접근 불가.

## 확인이 필요한 사항

- compute-insights를 Lovable에서 전체 재작성 배포(B안)까지 원하시면 현재 0.2.0 소스를 붙여 주세요. 그렇지 않으면 단계 2의 지시서를 그대로 Supabase 쪽에 적용하시는 방식으로 진행합니다.
