# Entity Verification v0.1.2 — 다운스트림 버전 게이트 패치 지시서

## 배경

`entity-verification` 판정 엔진은 Lovable 측 server-only 모듈
(`src/lib/entity-verification.engine.server.ts`, 클라이언트 번들 차단)로 이관되어
버전 `0.1.2`로 올라갔습니다. v0.1.2는 `PROBABLE_ONLY`를 절대 강등 조건으로 쓰지 않고,
강한 업체성 신호(BRANCH_MARKER / STRONG_BUSINESS_DESCRIPTOR / REGISTERED_BUSINESS_MATCH)
또는 동일 run 내 서로 다른 measurement 2건 이상 반복(REPEATED_ACROSS_RESPONSES)이 있으면
`specific_business`만 confirmed 처리합니다.

## 확인된 다운스트림 문제

`entity-canonical-resolver` Edge Function의 후보 조회는 `verifier_version = '0.1.1'`
(고정값)인 `confirmed_business` 행만 읽습니다. 실측 근거:

- run `cb08c8b4-…`에서 v0.1.2 confirmed 43건 생성 후 resolver 재실행 →
  `candidateCount = 13` (= `matched_business` 경로만), merged/standalone 0
- 전체 canonicalization 중 merged/standalone 22건은 모두 `verifier_version = 0.1.1`
  confirmed 행에 연결됨

그 결과 진단(`visibility-diagnostic`)의 관찰 경쟁업체는 여전히 0으로 남습니다.

## 필요한 최소 패치 (Supabase 측, 업체 비종속)

1. `entity-canonical-resolver`
   - 후보 조회의 `verifier_version` 상수 비교를 제거하고, 해당 mention에 대해
     **가장 높은 verifier_version 행**을 사용하거나 `verifier_version >= '0.1.2'`를
     허용하도록 변경 (권장: 상수 `ACCEPTED_VERIFIER_VERSIONS = ['0.1.2']`).
   - 병합 규칙/정규화/reason code 등 기존 보수적 merge 로직은 변경 금지.
2. `visibility-diagnostic` / `visibility-action-recommendations`
   - verification/canonical 행을 버전 상수로 필터링하는 곳이 있으면 동일하게 `0.1.2`를 포함.
3. 패치 후 재실행 순서(측정 API 재호출 없음):
   `entity-canonical-resolver` → `compute-insights-v024` → 진단/추천 조회.

업체명·UUID 기반 예외나 화이트리스트는 어느 단계에도 추가하지 않습니다.

## 추가 실험 (2026-08-28)

resolver 게이트가 `confidence='high'` 조건 때문일 가능성을 검증하기 위해
v0.1.2 confirmed 행의 confidence를 일시적으로 `high`로 올려 재실행했으나
`candidateCount`는 동일하게 13이었습니다. 따라서 게이트는 confidence가 아니라
`verifier_version` 상수(`0.1.1`) 고정이 원인입니다. (실험 후 confidence는 원래
값(medium)으로 되돌렸습니다.)
