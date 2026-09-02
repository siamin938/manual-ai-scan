# CHABOIM / 차보임 현재 개발 상태

> 스냅샷 기준: 2026-09-02
>
> 이 문서는 **변경 가능한 현황판**입니다. 작업 전 반드시 실제 repo, Supabase DB/RPC/Edge Function, 배포 상태와 대조하세요. 문서와 실제 상태가 다르면 실제 상태를 우선하되, 차이를 사용자에게 먼저 보고하세요.

## 1. 서비스 정의

- 서비스명: 차보임 / CHABOIM
- 대표 메시지: **“AI에서 우리 업체, 얼마나 보일까요?”**
- 현재 검증 대상: 자동차 관련 로컬 업체
- 핵심 가치:
  - 실제 고객이 물을 법한 다수 질문
  - 동일 조건 반복 측정
  - 내 업체 노출률
  - 질문 상황별 강점과 약점
  - 함께 관찰되는 경쟁업체
  - AI 답변에 실제 연결된 출처
  - 경쟁업체와 내 업체의 출처 차이
  - 우선 확인할 단서
  - 자동차 시장 누적 익명 Benchmark
  - 시간 변화 관찰

## 2. 현재 상품 후보

- 첫 AI 노출 진단 패키지: `69,000원` 후보
- 표준 24문항 측정 2회 포함
- 추가 측정권 1회: `29,000원` 후보
- 가격은 아직 최종 확정 전

## 3. 연결된 프로젝트 정보

### Lovable

- Project ID: `8f2b92cc-aa3c-4f84-b7bc-c3caa394dfdd`
- Workspace ID: `mjb8jQNjw2Mmqqaix2Oa`
- 문서에 기록된 최신 프론트 커밋: `a240b44e4edcff592fc442ee809d47017d87e757`
- 최신 변경은 Preview에만 반영, 프로덕션에는 새로 게시하지 않은 상태로 기록됨

### Supabase

- Project ID: `qoirkwmnyolquvsgbian`

### GitHub

- Repository: `siamin938/manual-ai-scan`
- 기본 브랜치: `main`
- Lovable과 양방향 동기화 연결됨

### 현재 주요 검증 업체 — 카스페이스 구로 본점

- `org_id`: `2673c44f-6706-4207-88f4-f2359b34df68`
- `business_id`: `8fa9168b-4dc2-4417-b2ef-bbdafd842c38`

## 4. 표준 질문 Generator 현황

- 표준 질문: 정확히 24개
- 구조: 8개 검색 상황 × 각 3문항
  1. 지역·접근성
  2. 추천
  3. 서비스·작업
  4. 후기·평판
  5. 전문성·신뢰
  6. 비교
  7. 가격·가성비
  8. 탐색·발견
- `suggest-questions` Edge Function: v19로 기록됨
- 표준 Generator: v1.0
- 현재 모델 기록: `gpt-5.6-luna`
- 최초 생성 후 validation/dedupe
- 부족한 scenario만 최대 2회 repair
- 정확히 24개일 때만 성공
- 미달 시 `AI_OUTPUT_INSUFFICIENT`

## 5. 질문 수정 정책

- 첫 측정 전 고객이 질문 문구 수정 가능
- 첫 Measurement Run 생성 이후 `측정 기준 고정`
- 이후 동일한 24문항으로 재측정
- 질문 세트 추가 / 개별 질문 추가 / 고객용 활성·비활성 기능은 제거됨
- 질문군, 지역 구조, 가중치, `data_class`는 고객 수정 대상 아님

## 6. 신규 업체 등록 정책

- 신규 업체: `is_client_business = true`, `active = true`
- 경쟁업체는 고객 수동등록이 아니라 측정에서 자동 발견
- 레거시 경쟁업체 데이터는 삭제하지 않고 고객 `내 업체` 목록에서만 숨김
- 주소/지역/홈페이지/네이버 플레이스/구글 지도 정보는 질문 생성·업체 식별·출처 분석을 위해 유지
- 기존 alias 보존 + 매우 안전한 별칭만 자동 추가
- legacy custom category 보존
- 한글 IME 마지막 글자 누락 방지 로직 유지

## 7. AI 노출 측정권 현황

고객 표현: `토큰`이 아니라 `AI 노출 측정권`

- 측정권 1회 = 표준 24문항 측정 1회
- 신규 조직은 0회 시작
- 가입만으로 무료 측정하지 않음
- standalone audit만 차감
- Experiment는 현재 차감 대상 제외

관련 DB:
- `measurement_credit_accounts`
- `measurement_credit_ledger`

보장해야 할 성질:
- `run_id` 기준 중복 차감 방지
- 새로고침/재시도 중복 차감 방지
- Job 생성 실패 시 같은 트랜잭션에서 rollback

## 8. 경쟁업체 Entity 파이프라인

현재 공통 흐름:

`Parser → Positive Evidence Gate → Verifier → Canonical Resolver → Competitor Significance Gate → 고객 진단`

문서에 기록된 버전:
- Parser v1.2.3
- Positive Evidence Gate v0.2
- Entity Verification 계열 유지
- Canonical Resolver v0.1.0
- Competitor Significance Gate v0.1

원칙:
- 1회 등장만으로 자동 확정하지 않음
- 구체적 업체 + 강한 구조 증거가 있을 때 확정
- confirmed mention만 경쟁업체 중요도 집계 사용
- 1회지만 실제 특정 업체로 강하게 확인되면 `추가 관찰`
- 1회 업체를 핵심 경쟁업체와 같은 급으로 표시하지 않음

## 9. compatible run 판정

compatible audit run 판정은 공통 RPC `get_compatible_audit_runs_v01` 사용을 기준으로 합니다.

작업 시 반드시 실제 DB/RPC 존재 여부와 현재 호출 경로를 먼저 확인하세요. 현재 계약이 유지되고 있다면 UI/Edge/RPC에 별도 compatible 판정을 중복 구현하지 마세요.

## 10. 카스페이스 구로 본점 최신 기록

과거 `20.8%`, `5/24`는 재분석 전 수치로 기록되어 있으므로 현재 기준으로 사용하지 않습니다.

문서 기준 최신 재분석:
- 유효 AI 답변: 24건
- 내 업체 추천: 8건
- AI 노출률: 33.3%
- 상위 3곳 안에 추천: 7건
- 함께 관찰된 업체: 8곳
- 주요 출처: 3곳

추천 확인 검색 상황:
- 서비스·작업
- 비교
- 탐색·발견
- 지역·접근성
- 추천
- 후기·평판
- 전문성·신뢰

미확인 검색 상황:
- 가격·가성비

고객 화면 경쟁업체 기록:
- 더플레이스카: 핵심 경쟁업체, 3개 답변
- 레이노 개봉점: 추가 관찰
- 제이존(J Zone): 추가 관찰
- 3M 썬팅 구로점: 추가 관찰
- BCC 구로점: 추가 관찰
- 레이노 천왕점: 추가 관찰
- 루마버텍스 구로고척점: 추가 관찰
- 카프랜드: 추가 관찰

## 11. 출처 분류 최신 정책

- 고객 화면의 출처는 검색 중 방문한 모든 사이트가 아님
- 최종 AI 답변에 실제로 연결된 출처 사용
- 직접 연결 출처는 인프라성 도메인이 아니면 주요 근거 인정
- 업체명 주변 출처는 동일 업체 측에서 여러 답변에 반복될 때 주요 근거로 승격
- 한 번만 관찰된 근거는 `추가 참고 출처`
- S3/object storage 같은 인프라 도메인은 고객 화면 제외
- raw 원본은 삭제하지 않고 보존
- 출처는 추천 원인/신뢰도 보증이 아님

카스페이스 주요 출처 기록:
- `soonwidot.co.kr`: 4개 답변, 총 6회 연결
- `oh-car.kr`: 3개 답변, 총 4회 연결
- `hunnytip.kr`: 1개 답변, 총 1회 연결

추가 참고 출처 기록:
- `3m.co.kr`
- `car.finance-information.net`
- `carting.co.kr`
- `daangn.com`
- `pf.kakao.com`

관련 마이그레이션 기록:
- `fix_actionable_citation_domain_support_v2`

## 12. 우선 확인 영역 판단 정책

현재 우선순위:

1. 실제 AI 답변에 연결된 출처 차이
2. 해당 출처와 연결된 경쟁업체
3. 내 업체가 같은 출처와 연결됐는지
4. 실제 페이지의 업체 정보 완성도·구체성·최신성
5. 질문군은 차이가 발생한 검색 상황을 설명하는 보조 정보

반복 결과 전까지 인과 단정 금지.

## 13. 최근 완료 — 출처 기반 추천 개선

Supabase Edge Function 기록:
- `visibility-action-recommendations` v14
- `verify_jwt = true`
- evidence version `0.6.0`
- 기존 추천 순위/판정 로직 유지
- platform DTO optional field:

```ts
linkedCompetitors: { name: string; url: string | null }[]
```

보안 정책:
- DB 저장 실제 citation URL만 사용
- 업체명/도메인으로 URL 추측 또는 조합 금지
- http/https만 허용
- URL host와 저장 출처 도메인 일치 여부 서버 검증
- 검증 불가 URL은 `null`
- 프론트도 javascript/data/상대 URL fail-closed

현재 UI 기록:
- `함께 연결된 업체` 아래 업체명 칩
- URL 있으면 새 탭으로 실제 출처 페이지
- URL 없으면 일반 텍스트 칩
- 안내 문구: `AI 답변에 실제 연결된 출처 페이지입니다. 업체별 상세 페이지가 아닐 수 있습니다.`
- Preview에서 정상 표시 확인 기록

## 14. 고객 진단 화면 최신 문구

상단 지표:
1. AI에서 내 업체가 추천된 비율
2. 상위 3곳 안에 추천된 답변
3. AI 답변에서 함께 관찰된 업체
4. AI 답변에 연결된 주요 출처

경쟁업체 카드 제목:
- `AI 답변에서 함께 관찰된 업체`

첫 측정 추천 영역:
- `첫 측정에서 먼저 확인할 단서`
- 첫 측정은 실행 권고/확정 해결책이 아니라 관찰 후보
- 두 번째 동일 조건 측정에서 반복될 때 우선순위 상승

Global Benchmark 초기 상태 배지:
- `데이터 축적 중`

## 15. Global Automotive Benchmark

- 전체 자동차 업종 최근 측정 데이터를 서버 내부에서 익명 집계
- 다른 조직 업체명/원본 측정값/고객사 정보는 고객에게 숨김
- 출처 유형, 사이트 패턴, 고노출 업체 집계 수, 익명 비율, 내 업체 관찰 여부만 고객에게 표시 가능
- 현재 초기 표본이므로 `데이터 축적 중` 표시
- 적은 표본을 일반 시장 법칙처럼 표현하지 않음

## 16. 최신 프론트 변경 기록

최신 기능 변경 파일 기록:
- `src/lib/visibility-actions.types.ts`
- `src/lib/visibility-actions.server.ts`
- `src/lib/visibility-actions.server.test.ts`
- `src/components/action-recommendations-section.tsx`
- `src/routes/_authenticated/dashboard.tsx`

`src/integrations/supabase/types.ts` 자동 포맷 차이는 직전 버전으로 복원했다고 기록됨.

최종 검증 기록:
- TypeScript 검사 통과
- Vitest 14개 파일
- 총 136개 테스트 통과
- Production build 성공
- 최신 변경은 프로덕션 미게시

## 17. 고객 측정 상세 화면 정책

진행 중 표시:
- `AI 노출 측정 진행 중`
- `N / 24 질문 확인 완료`
- Progress bar
- 완료 후 최종 결과 표시 안내

고객에게 숨김:
- 실제 비용/예상 비용
- 모델명/provider
- parser version
- confidence
- 수동 검토 상태
- 내부 error code
- alias matching
- service role
- 내부 scoring/threshold

용어:
- `작업 목록` 대신 `질문별 결과`

고객용 컬럼:
- 질문
- 상태
- 우리 업체 노출
- 상세

측정 완료 후에만 최종 노출률/경쟁업체/출처 표시.

## 18. 출시 직전 Security Hardening — 아직 미실행

일반 기능 작업과 섞지 않고 출시 직전 별도 진행:

1. `create_organization_with_owner`
   - 브라우저 직접 RPC 호출 → 서버/Edge Function 전용 구조
2. Supabase Auth
   - Leaked Password Protection 활성화
3. Security Advisor
   - 전체 재점검
   - SECURITY DEFINER 함수 권한/RLS 경고 검토

기존 정상 함수/정책을 근거 없이 일괄 수정하지 않음.

## 19. 현재 작업 시작 규칙

현재 기록상 출처 링크와 고객용 문구 개선까지 완료됐고 Preview 확인이 끝났습니다. 완료된 작업을 다시 만들지 않습니다.

새 작업 시:
1. 요청과 원하는 결과 정리
2. repo 최신 커밋 + Supabase 실제 상태 확인
3. DB/RPC/Edge/DTO/UI 중 원인 위치 확인
4. 수정 전 원인과 최소 변경 범위 설명
5. 구현 요청이 있을 때만 수정
6. Supabase 우선
7. UI 필요 시 프론트 최소 수정
8. 요청 밖 diff 확인
9. 타입체크/테스트/빌드
10. Preview까지만 반영
11. 프로덕션은 별도 승인

## 20. 다음 논리적 후보 — 자동 진행 금지

- 카스페이스 동일 24문항 두 번째 측정
- 첫 관찰과 반복 관찰 결과 비교
- 다른 자동차 업종 신규 업체 범용성 검증
- 관리자용 회원·측정권 지급·잔액·내역 화면
- 결제 연결 전 Credit 운영 화면 완성
- 출시 직전 Security Hardening

사용자의 다음 지시 없이 임의 수정, 새 측정, 프로덕션 게시를 하지 않습니다.
