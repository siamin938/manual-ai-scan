# CHABOIM / 차보임 현재 개발 상태

> 스냅샷 기준: **2026-09-04 23:38 KST**
>
> 이 문서는 **변경 가능한 현황판**입니다. 작업 전 반드시 실제 GitHub `main`, Supabase DB/RPC/Edge Function, 배포 상태와 대조하세요. 문서와 실제 상태가 다르면 실제 상태를 우선합니다.
>
> 고정 개발 원칙은 `AGENTS.md`를 우선합니다.

---

## 1. 서비스 정의

- 서비스명: **차보임 / CHABOIM**
- 대표 메시지: **“AI에서 우리 업체, 얼마나 보일까요?”**
- 현재 검증 범위: **자동차 관련 로컬 업체**
- 핵심 가치:
  1. 실제 고객이 물을 법한 다수 질문 생성
  2. 동일 조건 반복 측정
  3. 내 업체 AI 노출률 확인
  4. 검색 상황별 강점/약점 확인
  5. 함께 관찰되는 경쟁업체 발견
  6. AI 답변에 실제 연결된 출처 확인
  7. 경쟁업체와 내 업체의 출처 차이 확인
  8. 우선 확인할 단서 제시
  9. 자동차 시장 누적 익명 Benchmark
  10. 시간에 따른 변화 관찰

서비스 표현 원칙:
- 인과를 확정하지 않음
- `추천 원인`, `노출 보장`, `순위 보장` 표현 금지
- `함께 관찰`, `먼저 확인할 단서`, `반복 측정에서 다시 확인`, `변경 후 변화 관찰` 중심으로 표현

---

## 2. 현재 상품 후보

- 첫 AI 노출 진단 패키지: **69,000원 후보**
- 표준 24문항 측정 **2회 포함**
- 추가 측정권 1회: **29,000원 후보**
- 가격은 아직 최종 확정 전

고객 표현:
- `토큰` 대신 **AI 노출 측정권**
- 측정권 1회 = 표준 24문항 standalone audit 1회

---

## 3. 연결 프로젝트

### GitHub

- Repository: `siamin938/manual-ai-scan`
- 기본 브랜치: `main`
- Lovable과 양방향 동기화 연결

### Supabase

- Project ID: `qoirkwmnyolquvsgbian`

### Lovable

- Project ID: `8f2b92cc-aa3c-4f84-b7bc-c3caa394dfdd`
- Workspace ID: `mjb8jQNjw2Mmqqaix2Oa`
- UI Preview 확인이 필요한 경우에만 최소 사용
- 최신 기능은 Preview 기준으로 검증 중이며 Production publish는 별도 승인 전까지 하지 않음

### Codex

- GitHub `main`을 기준점으로 사용
- 여러 파일 구조 변경, 복잡한 버그 추적, 타입/테스트/빌드 검증에 적극 활용 가능

---

## 4. 개발 작업 원칙 요약

상세 내용은 `AGENTS.md`가 우선입니다.

- Supabase 우선
- 수정 전 실제 원인 확인
- 기존 정상 경로 보존
- 최소 수정
- 특정 업체 하드코딩 금지
- Core Engine Isolation
- 조직 간 데이터 격리
- 비용/호출/재시도 상한 유지
- compatible run 판정 중복 구현 금지
- 고객 화면에 내부 score/threshold/model/cost 노출 금지
- Production publish는 별도 승인

---

## 5. 표준 질문 Generator

- 표준 질문: **정확히 24개**
- 구조: **8개 검색 상황 × 각 3문항**
  1. 지역·접근성
  2. 추천
  3. 서비스·작업
  4. 후기·평판
  5. 전문성·신뢰
  6. 비교
  7. 가격·가성비
  8. 탐색·발견
- 최초 생성 후 validation/dedupe
- 부족 scenario만 제한적으로 repair
- 정확히 24개일 때만 성공
- 첫 측정 전 고객이 문구 수정 가능
- 첫 Measurement Run 이후 **측정 기준 고정**
- 이후 반복 측정은 동일 24문항 사용

질문 지역값은 화면 문구뿐 아니라 실제 Provider request까지 검증해야 함.

---

## 6. 신규 업체 등록 정책

- 신규 업체: `is_client_business = true`, `active = true`
- 경쟁업체는 고객 수동등록이 아니라 AI 측정에서 자동 발견
- 주소/지역/홈페이지/네이버 플레이스/구글 지도 정보 유지
- 기존 alias 보존 + 매우 안전한 별칭만 자동 추가
- 업체별 예외/금지어 하드코딩 금지
- 같은 현실 업체가 다른 조직에서 각각 등록되는 것은 허용
- 고객 조직의 `business_id`와 측정 데이터는 서로 합치지 않음

같은 현실 업체 여부는 고객 데이터 병합이 아니라 **Benchmark 집계용 identity**에서만 별도로 판단합니다.

---

## 7. 현재 실사용 Entity/후처리 파이프라인

2026-09-04 실제 `system_events` 최신 완료 로그 기준:

`Parser 1.2.3 → visibility-postprocess Pipeline 0.1.4 → Verifier 0.1.5 → Resolver 0.1.1 → Citation Attribution`

공통 Entity 흐름:

`Parser → Positive Evidence Gate → Verifier → Canonical Resolver → Competitor Significance Gate → 고객 진단`

현재 중요 원칙:
- 1회 등장만으로 핵심 경쟁업체 확정 금지
- 실제 특정 업체라는 강한 증거 필요
- 설명형/비교형 섹션 제목을 업체로 승격하지 않음
- 한 번만 강하게 확인된 업체는 `추가 관찰`
- 동일 측정 안에서 여러 답변에 등장하면 `자주 관찰`
- 동일 조건 2회 이상에서도 반복되면 `반복 측정에서도 관찰`

2026-09-04 수정:
- `성남 엔진오일 정비소 비교`처럼 **업종명 + 비교/추천/정리 등의 섹션 제목**이 업체로 잡히는 오탐을 Competitor Significance Gate에서 공통 차단
- 원본 measurement/canonical 데이터는 삭제하지 않음

---

## 8. compatible audit run 공통 계약

공통 RPC:

`public.get_compatible_audit_runs_v01(p_org_id uuid, p_business_id uuid, p_limit integer default 6)`

현재 비교 계약:
- 동일 `question_set_id`
- 동일 `data_origin`
- 동일 `selected_providers`
- 동일 `repetitions`
- 동일 job 수
- 동일 measurement 수
- 동일 parser version 집합
- provider payload 완전성
- job별 `question_id`, provider, provider model, repetition, redacted request 계약

원칙:
- UI/Edge/RPC에서 별도 compatible 판정 새로 만들지 않음
- 내부 테스트와 실제 고객 측정은 질문 세트가 같아도 `data_origin`이 다르면 반복 측정으로 합치지 않음

---

## 9. 현대엑스티어 판교 동일 조건 2회 리허설 — 완료

### 등록 구조

같은 현실 업체인 현대엑스티어 판교를:
- 기존 내부 테스트 조직
- 카포먼스 본점 조직

에 각각 별도 `business_id`로 등록하여, 실제 고객이 이미 테스트된 업체를 다시 등록하는 상황을 검증했습니다.

결론:
- 고객/조직 데이터는 완전 분리 유지
- 기존 측정 데이터도 보존
- Benchmark 현실 업체 수에서만 동일 업체 중복 제거

### 새 카포먼스 본점 현대엑스티어 판교 질문 세트

- 활성 질문: 24개
- 8개 질문군 × 각 3개
- 분당구 질문 8개 → `경기도 / 성남시 분당구`
- 성남 질문 16개 → `경기도 / 성남시`
- 실제 Provider request에서도 지역 불일치 **0건**

### 1차 측정

- Run: 24/24 완료
- 실패 0
- 내 업체 노출: **0/24 (0%)**
- 원문에 `엑스티어` 표면형 없음 → Parser 누락이 아니라 해당 측정의 실제 미노출로 판단
- 측정권 1회만 차감

### 2차 측정

- 1차와 동일 질문 세트/Provider/반복 조건
- 24/24 완료
- 실패 0
- 내 업체 노출: **0/24 (0%)**

### 반복 비교 결과

- 동일 조건 2회
- 유효 AI 답변: **48건**
- 24문항 모두 **2회 모두 미추천**
- 통합 노출률: **0.0%**
- 통합 Top3 노출률: **0.0%**

반복 업체 예:
- 삼인자동차공업사: 1차 3답변 + 2차 3답변
- 공임나라 분당수내점: 1차 3답변 + 2차 2답변

마이클(`service.mycle.co.kr`) 반복 출처 단서:
- 서비스·작업 질문 6답변(3문항 × 2회) 중 4답변에서 의미 있는 함께 관찰 업체와 연결
- 연결 업체 4곳
- 두 Run 모두에서 반복 확인
- 현대엑스티어 판교와 연결된 답변 0건
- 따라서 `추천 원인`이 아니라 **반복 측정에서 확인된 우선 출처 단서**로 승격하는 것이 타당함

---

## 10. 고객 진단 화면 최근 개선

### 경쟁업체 표현

1회 compatible run:
- tier core → `자주 관찰`
- 1회 강한 단일 업체 → `추가 관찰`

2회 이상 compatible run:
- 반복 확인 업체 → `반복 측정에서도 관찰`

### 출처 추천 중복 제거

- 같은 sourceKey가 여러 질문군 추천 카드에 반복되던 문제 수정
- 같은 출처는 대표 source 카드 한 곳에서 설명
- 일반 질문군 카드는 유지하되 이미 대표 카드에서 설명된 출처 블록만 표시용으로 제거
- 서버 rank/score/판정 원본은 변경하지 않음

### 공유형 블로그 fail-closed

현재 Edge DTO만으로 소유 여부를 확인할 수 없는:
- 티스토리
- 네이버 블로그

는 `콘텐츠 개선`으로 단정하지 않고 **`외부 콘텐츠 확인`**으로 표시.

직접 수정 가능한 내 채널이라는 증거가 없으면:
- 외부 글에서 내 업체 언급 확인
- 함께 관찰된 업체와 정보 차이 참고
- 외부 노출 신호로만 관찰

### 측정 시작 모달

기존 `예상 사용량 24회` 오해 문구 수정:
- 측정 질문 24개
- 차감 예정 측정권 1회
- 측정 후 남는 측정권 표시

실제 차감 로직도 1 Run당 1회로 검증됨.

---

## 11. 출처 분류/표현 정책

- 검색 중 방문한 모든 사이트가 아니라 **최종 AI 답변에 실제 연결된 출처** 사용
- 직접 연결 또는 반복 근거 중심
- 약한 1회 근거는 추가 참고 출처
- 인프라성 도메인은 고객 주요 출처에서 제외
- raw 원본은 삭제하지 않고 보존
- 출처 자체가 추천 원인/신뢰도 보증이라는 뜻이 아님
- 실제 DB에 저장된 citation URL만 외부 링크로 사용
- 업체명/도메인 기반 URL 추측/조합 금지
- URL host 검증 실패 시 fail-closed

---

## 12. 측정 데이터 origin 분리 — 완료

측정 데이터 원천:

- `internal_observation`
  - 차보임이 직접 테스트/관찰하며 쌓은 실제 측정 데이터
  - 고객용 익명 Benchmark에 포함
- `customer_measurement`
  - 실제 고객 측정 데이터
  - 고객용 익명 Benchmark에 포함
- `demo`
  - 시연용
  - Benchmark에서 제외

DB:
- `organizations.measurement_data_origin`
- `measurement_runs.data_origin`

정책:
- 기존 출시 전 테스트 조직/Run → `internal_observation`
- 앞으로 새 일반 조직 기본값 → `customer_measurement`
- Run 생성 시 DB trigger가 **조직의 measurement_data_origin을 최종 권위값으로 강제**
- 앱이 잘못된 `data_origin`을 전달해도 DB가 조직 origin으로 덮어씀

롤백 검증:
- 새 조직 기본값 `customer_measurement` 확인
- Run에 일부러 `demo`를 전달해도 `customer_measurement`로 교정됨
- 테스트 row는 모두 rollback되어 실제 DB에 남지 않음

고객 측정이 Benchmark 자격을 충족한다고 가정한 롤백 테스트:
- internal eligible Run 9
- customer eligible Run 1
- 기여 origin 수 2
- 두 origin 동시 포함 정상 확인
- 원본 Run은 rollback 후 `internal_observation`으로 복구 확인

---

## 13. Benchmark 현실 업체 identity — 완료

문제:
- 같은 현실 업체가 다른 조직에서 별도 등록되면 `count(distinct business_id)`가 현실 업체 수를 부풀릴 수 있음

현재 해결:
- 고객의 `business_id`, Run, 질문, 조직 데이터는 절대 병합하지 않음
- Benchmark의 **현실 업체 수 집계에만** 별도 identity key 사용

엄격한 identity 기준 v0.1:
- 업체명
- 국가
- 지역
- 도시
- 도로명/번지 등 주소 강한 증거

위 증거가 충분할 때만 동일 현실 업체로 묶음.
증거가 부족하면 잘못 합치는 대신 `business_id` fallback으로 중복을 허용하는 fail-closed 방식.

현대엑스티어 판교 두 등록 건은:
- 같은 이름
- 같은 지역/도시
- `대왕판교로 311`까지 일치

하여 Benchmark에서 현실 업체 1곳으로 정상 집계됨.

---

## 14. Global Automotive Benchmark 현재 상태

2026-09-04 실제 DB 집계:

- `internal_observation` 현실 업체: **5곳**
- 완료 standalone audit: **16회**
- 유효 AI 답변: **260건**
- 최근 90일 Benchmark eligible Run: **10회**
- 최근 90일 Benchmark 현실 업체: **5곳**
- 현재 실제 기여 origin: **1종 (`internal_observation`)**
- `customer_measurement`: 아직 실제 운영 데이터 0
- `demo`: 0

고객 Benchmark 포함 대상:
- 내부 관찰 + 고객 측정

제외:
- demo

고객 화면 원칙:
- 다른 고객의 업체명/원본 답변/조직 정보 노출 금지
- 익명 집계만 사용
- 현재 초기 표본이므로 `데이터 축적 중` 표현 유지
- 적은 표본을 일반 시장 법칙처럼 단정하지 않음

---

## 15. 내부 운영자용 데이터 자산 화면 — 완료

경로:
- `/data-assets`

일반 고객:
- 메뉴 자체 숨김
- URL 직접 접근해도 서버 RPC 권한에서 차단

현재 접근 조건:
- `internal_observation` 조직의 `owner`

표시 내용:
- 내부 관찰 데이터
- 고객 측정 데이터
- 데모 데이터
- 현실 업체 수
- 완료 Run
- 유효 AI 답변
- 조직 수
- 최근 완료 시각
- 최근 90일 Benchmark 현실 업체/Run/기여 origin

문구:
- `벤치마크 포함 Run`
- `벤치마크 포함 대상`
- `현재 기여 origin 수`
- `현실 업체 식별 기준 v0.1`

민감한 업체명/조직명/원본 답변/ID는 데이터 자산 요약 화면에 노출하지 않음.

---

## 16. AI 노출 측정권 구조

DB:
- `measurement_credit_accounts`
- `measurement_credit_ledger`

현재 보장:
- 신규 조직 0회 시작
- standalone audit만 차감
- Experiment 현재 차감 제외
- `run_id`별 `measurement_debit` UNIQUE
- `reference_key` UNIQUE
- account row lock 후 재확인으로 동시 enqueue 중복 차감 방지
- 측정 1 Run당 1회 차감

기존 지급 함수:
- `grant_measurement_credits_v01`
- 직접 실행 권한: `postgres`, `service_role`
- 일반 authenticated 고객은 직접 실행 불가

---

## 17. 내부 운영자용 측정권 관리 — 완료

경로:
- `/measurement-credits`

일반 고객:
- 메뉴 숨김
- 관리자 조회/지급 RPC 모두 권한에서 차단

내부 운영자 기능:
- 조직별 현재 잔액
- 누적 지급
- 누적 사용
- 활성 업체 수
- 최근 원장 최대 50건
- 측정권 양수 지급만 가능
- 회수/음수 조정/삭제 기능 없음
- UI 지급 범위 1~100회
- 지급 전 확인 Dialog
- 지급 중 버튼 비활성화
- 지급 성공 후 overview/ledger refetch

관리 RPC:
- `get_measurement_credit_admin_overview_v01`
- `get_measurement_credit_admin_ledger_v01`
- `admin_grant_measurement_credits_v01`

안전성 롤백 테스트:
- 동일 reference_key로 2회 요청
- 첫 요청만 +2
- 두 번째 `idempotent=true`
- ledger 1건만 생성
- rollback 후 원래 잔액 복구
- 일반 고객 컨텍스트에서는 overview/grant 모두 차단

2026-09-04 화면/DB 대조:

카포먼스 본점:
- 잔액 1
- 누적 지급 5
- 누적 사용 4
- 활성 업체 3
- 원장 흐름: +5 지급 → -1 × 4 → 잔액 1

시아민 마케팅:
- 잔액 0
- 누적 지급 0
- 누적 사용 0
- 활성 업체 4

화면과 실제 DB 일치 확인 완료.

---

## 18. 고객 측정 상세 화면 정책

진행 중:
- `AI 노출 측정 진행 중`
- `N / 24 질문 확인 완료`
- Progress bar
- 완료 후 최종 결과 표시

고객에게 숨김:
- 실제/예상 비용
- 모델/provider
- parser version
- confidence
- 수동 검토 상태
- 내부 error code
- alias matching
- service role
- 내부 scoring/threshold

고객용 질문별 결과:
- 질문
- 상태
- 우리 업체 노출
- 상세

측정 완료 후에만 최종 노출률/경쟁업체/출처 표시.

---

## 19. 최근 프론트/검증 상태

최근 주요 추가 파일/경로:
- `src/routes/_authenticated/data-assets.tsx`
- `src/lib/data-asset-admin.functions.ts`
- `src/routes/_authenticated/measurement-credits.tsx`
- `src/lib/measurement-credit-admin.functions.ts`
- `src/routes/_authenticated/route.tsx`
- `src/components/action-recommendations-section.tsx`
- `src/routes/_authenticated/dashboard.tsx`

최근 기능 커밋 예:
- `6a46692` — 측정권 관리 화면 추가

최근 검증:
- `npx tsc --noEmit` 통과
- Vitest **17파일 / 163개 테스트 통과**
- `npm run build` 성공
- Production publish 안 함

주의:
- Supabase schema 변경 후 generated `src/integrations/supabase/types.ts`가 갱신될 수 있음
- 요청 밖 자동 수정은 반드시 diff 검수

---

## 20. 출시 직전 Security Hardening — 아직 미실행

일반 기능 작업과 섞지 않고 출시 직전 별도 진행:

1. `create_organization_with_owner`
   - 현재 브라우저 직접 RPC 가능 구조
   - **서버/Edge Function 전용 경로로 전환**
2. Supabase Auth
   - **Leaked Password Protection 활성화**
3. Security Advisor
   - 전체 재점검
   - SECURITY DEFINER 함수 실행 권한/RLS 경고 재검토
4. 내부 운영 권한
   - 현재 `internal_observation` 조직 owner 기반 내부 관리자 권한을 장기적으로 별도 `platform_admin` 역할로 분리할지 출시 전 검토

정상 함수/정책을 근거 없이 일괄 수정하지 않음.

---

## 21. 주요 Edge Function 마지막 확인 스냅샷

아래 배포 version 숫자는 2026-09-02 교차검증 기록이며, semantic pipeline 버전은 2026-09-04 실제 event로 다시 확인했습니다.

2026-09-02 배포 스냅샷:
- `suggest-questions` v19 — `verify_jwt=true`
- `visibility-action-recommendations` v14 — `verify_jwt=true`, evidence `0.6.0`
- `visibility-diagnostic` v7 — `verify_jwt=true`
- `visibility-repeat-aggregate` v2 — `verify_jwt=true`
- `visibility-benchmark` v4 — `verify_jwt=true`
- `visibility-postprocess` — 내부 postprocess token 인증 구조
- `reparse-measurements` — 함수 내부 Bearer 사용자 JWT/조직 역할 검증
- `process-measurement-job` — `x-internal-secret` 기반 내부 호출 검증

`verify_jwt=false` 값 하나만 보고 보안 오류로 판단하지 않습니다. 함수 내부 별도 인증 구조까지 함께 확인해야 합니다.

2026-09-04 실제 최신 event semantic 버전:
- Pipeline `0.1.4`
- Verifier `0.1.5`
- Resolver `0.1.1`

---

## 22. 현재 완료된 큰 리허설

완료:
- 카스페이스 고객 진단 기반 구축
- 신규 자동차 업체 24문항 측정 흐름 검증
- 질문 지역 범위 실제 Provider request 검증
- 현대엑스티어 판교 다른 조직 중복 등록 검증
- 현대엑스티어 판교 동일조건 2회 반복 측정
- 경쟁업체 반복 관찰 표현 검증
- 출처 단서 반복 승격 검증
- 동일 출처 추천 카드 중복 제거
- 제3자 블로그 소유 여부 fail-closed
- 섹션 제목 경쟁업체 오탐 차단
- data origin 분리
- 고객 데이터 origin 롤백 E2E 검증
- Benchmark 현실 업체 중복 제거
- 데이터 자산 관리자 화면
- 측정권 관리자 지급/잔액/내역 화면
- 지급 idempotency/일반 고객 차단 검증

---

## 23. 다음 논리적 후보 — 자동 진행 금지

### 1순위 — 실제 베타 고객 1개 조직 E2E 리허설

실제 신규 고객 계정으로:

`회원가입 → 조직 생성(customer_measurement) → 업체 등록 → 24문항 생성 → 관리자 측정권 2회 지급 → 1차 측정 → 2차 동일조건 측정 → 고객 진단 → customer_measurement Benchmark 편입`

을 처음부터 끝까지 검증합니다.

목표:
- 롤백/내부 테스트가 아닌 **실제 고객 경로 전체 완주**
- 고객 조직에서 내부 관리자 메뉴가 보이지 않는지 확인
- 측정권 지급/차감 UX 확인
- 2회 패키지의 실제 상품 흐름 검증
- 고객 측정 데이터가 데이터 자산 화면에 `customer_measurement`로 쌓이는지 확인

실제 AI 측정 비용/측정권이 발생하므로 사용자 승인 후 진행.

### 2순위 — 자동차 업종 범용성 추가 검증

현재 정비/엔진오일 외 다른 자동차 서비스 유형 신규 업체로:
- 썬팅/신차패키지
- 타이어/휠
- PPF/랩핑
- 튜닝/전장
- 디테일링

중 하나를 새로 검증.

특정 업체 패치가 아니라 공통 파이프라인 범용성을 확인하는 목적.

### 3순위 — 결제 연결 설계/구현

- 상품 가격 최종 확정 후 진행
- 결제 성공 → reference_key 기반 측정권 지급
- webhook/idempotency/환불 정책 설계
- 결제와 실제 AI 비용 상한 연결

### 4순위 — 출시 직전 Security Hardening

- 조직 생성 서버 전용화
- Leaked Password Protection
- Security Advisor/RLS/SECURITY DEFINER 전체 재점검

---

## 24. 새 작업 시작 체크리스트

1. 사용자 요청/원하는 결과 정리
2. GitHub `main` + 실제 Supabase 상태 확인
3. DB/RPC/Edge/DTO/UI 중 원인 위치 확인
4. 수정 전 원인과 최소 변경 범위 확정
5. Supabase에서 가능한 작업은 Supabase 우선
6. UI만 필요한 경우 프론트 최소 수정
7. 여러 파일/복잡한 구조면 Codex 활용
8. Lovable은 Preview/시각 조정이 실제로 필요할 때만 최소 사용
9. 요청 밖 diff 반드시 확인
10. 타입체크/테스트/빌드
11. Preview 확인
12. Production publish는 별도 승인
13. 비용 발생 측정은 별도 승인
