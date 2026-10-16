# 차보임 Action Opportunity v1.0 · 고객 공개 준비 (Draft, 미공개)

2026-10-16 · 검토 대상: `feat/action-v1-customer-release-prep-v01`

## 제품 방향

- 기존 핵심 요약('24번 물어봤더니...', KPI 3개, 질문 종류 카드, 다른 업체 카드, '이번 측정에서 확인할 2가지')을 유지한다.
- 고객용으로 새 대형 진단 보고서나 별도 탭을 만들지 않는다.
- 고객이 핵심 요약의 확인 항목에서 **'판단 근거 자세히 보기'**를 펼치면 해당 항목의 저장된 사실/확인 작업만 볼 수 있도록 준비한다.
- 내부 관리자의 비공개 미리보기는 **현재 그대로 보존**한다.
- 신규 점수/우선순위 랭킹/순위 보장/원인 단정/개선 효과 보장은 없다.

## 이 Draft에 포함된 것

1. `src/lib/action-opportunity-v1.customer-release-candidate.ts`: 서버에서 생성된 현재 조직·업체·Run·측정 시점·수치와 내부 모델의 스코프가 모두 같고, 기존 요약 항목과 규칙/증거가 일치할 때만 내용을 투영하는 순수 함수
2. `src/components/action-opportunity-v1-customer-evidence-candidate.tsx`: 펼침형 고객용 UI 구성요소, **어느 라우트에서도 사용하지 않음**
3. `tests/entity-engine-v2/action-opportunity-v1.customer-release-candidate.test.ts`: 정상 일치/타 계정/타 조직/타 업체/타 Run/불일치 수치/미검증 페이지/무관한 규칙/내부 필드 비노출/기존 대시보드 보존 검증

## 중요한 보안 경계

- 기존 `getActionOpportunityV1DashboardPrivatePreview` 관리자 API를 **고객용으로 그대로 공개하지 않는다.**
- 고객용 API를 도입할 때는 `requireSupabaseAuth`, `organization_members`의 사용자·조직 멤버십, 선택 업체의 org 일치 및 **서버에서 다시 읽은 최신 대표 Run** 일치를 확인해야 한다.
- 고객이 보낸 수치, 업체명, evidence, preview 모델을 신뢰하지 않는다.
- 서버는 Entity Facts v2 Read Gateway의 정확한 대표 Run을 조회한 후, 기존 결정론적 v1.0 규칙과 고객용 요약을 **같은 데이터로 재생성**한다.
- 응답은 고객 공개 허용 문구와 관련 수치로 최소화한다. admin 전용 score, threshold, confidence, priority, rank, 전체 내부 단서, 비검증 인용 URL은 반환하지 않는다.
- `verified_citation_page_gap`은 관련성 검증 **완료+0개**일 때만 연결한다. `pending/not_verified`를 0개로 승격하지 않는다.
- React Query 캐시 키에는 session user / org / business / Run ID를 모두 포함하고 로그아웃 시 기존 캐시 제거를 유지한다.
- 테넌트·업체·Run 불일치/중복 후보/판정 근거 차이는 모두 fail-closed 처리한다.

## 고객 공개 전 Gate (아직 미통과)

- [ ] 고객용 서버 읽기 API: 별도 리뷰·보안 테스트·부정 케이스 검증
- [ ] 기존 핵심 요약과 경량 펼침형 UI 연계 (별도 승인 전 연결하지 않음)
- [ ] 실제 로그인 관리자/일반 고객·테넌트 간 격리 브라우저 QA
- [ ] Lovable Preview Runtime Gate: 정확한 Git SHA / server secret **존재 여부만** / 요청 로그
- [ ] 핵심 요약/상세 분석/인쇄·PDF의 기존 결과 회귀 확인
- [ ] 사용자 명시 승인 후 PR 병합·고객 공개

## 측정 기록 PR #12와의 관계

- 측정 기록 PR #12는 **독립된 Draft**로 유지하며, Runtime Gate 부재로 인한 실화면 QA는 보류한다.
- 이 Draft의 대상은 PR #11의 개발 브랜치이며 PR #12를 병합하지 않는다.
- 이 범위에서 DB 수정/AI 재측정/측정권 차감/스케줄러 변경/배포는 없다.
