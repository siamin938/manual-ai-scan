# Action Opportunity v1.0 · 고객 전용 근거 조회 API 후보 (미공개)

## 범위 및 의존 관계

- 기반: PR #13의 읽기 전용 순수 고객 근거 투영 함수와 렌더링 후보 구성요소
- 이 단계: 고객 전용 `getActionOpportunityV1CustomerEvidence` 서버 함수 + 순수 서버 DTO 조립 + 검증 테스트
- **어느 화면에도 연결하지 않음.** 현재 고객 핵심 요약·관리자 비공개 미리보기·인쇄/PDF·측정/결제 경로는 그대로
- PR #11/12/13 Draft 유지, 운영 DB·Edge·크레딧·AI 측정에 변경 없음

## 단일 요청 계약

`POST` server function에 `orgId`, `businessId`, `expectedRunId`, `insightId`만 입력한다.

`insightId`는 현재 핵심 요약의 최대 2개 항목 중 하나여야 한다. 수치/업체명/인용 상태/출처/근거는 **클라이언트에서 전송하거나 신뢰하지 않는다**.

허용되는 관찰 종류:

- `zero_confirmed`
- `broad_scope_gap`
- `verified_page_zero`
- `repeated_competitor`
- `top3_unconfirmed`

`verified_page_present`는 현재 v1.0 대응 규칙이 없어 의도적으로 거절한다. 출처 비교 내부 관찰도 새 고객 API에서 제공하지 않는다.

## 서버 권한 검증 순서

1. `requireSupabaseAuth`로 현재 사용자를 확인
2. 사용자의 RLS-scoped `organization_members`에서 현재 조직 멤버십 확인 (관리자 또는 고객 뷰어 모두 자기 조직만)
3. 동일한 RLS-scoped 세션으로 `businesses`의 조직·업체 ID·`is_client_business=true`·`active=true` 확인
4. 기존 `fetchEntityFactsV2ReadGateway`를 서버에서 직접 조회, 실제 선택된 최신 대표 Run이 `expectedRunId`와 완전히 같아야 진행
5. 그 Run에서만 v2 대시보드 요약·최대 2개 확인 항목·v1.0 결정론적 근거를 재계산
6. Rule ID·실제 수치·관찰 업체·검증 상태를 모두 재검증한 뒤 고객용 제목/작업/사실/판단 근거/고지만 반환
7. 실패 시 다른 Run 대체, 고객 권한 상승, 임의 데이터 보완 없이 fail-closed

**관리자 전용 `getActionOpportunityV1DashboardPrivatePreview`의 권한을 풀거나 재사용하지 않는다.**

## 응답 공개 범위

성공 응답은 요청 조직/업체/Run/현재 요약 항목 ID와 `detail`의 고객용 텍스트·라벨·근거만 포함한다. 내부 rank/priority/confidence, 모델 점수/가중치/threshold, 확인되지 않은 링크, 원본 측정 payload 등은 포함하지 않는다.

다른 Run의 캐시가 표시되지 않도록 향후 프런트의 React Query 키에는 session 사용자 ID + 조직 + 업체 + 현재 대표 Run + 항목 ID를 모두 넣어야 한다. 화면을 연결할 때는 응답 scope 일치와 로그인 상태를 다시 확인한다.

## 실제 고객 공개 전 필요한 QA (미완료)

- [ ] 추가 고객용 읽기 API의 실제 owner/admin/analyst/client_viewer 세션 권한·타 조직 부정 테스트
- [ ] 최신 Run 변경과 업체/조직 변경 시 이전 응답 차단, 새로고침/로그아웃 캐시 제거
- [ ] Lovable 별도 테스트 Preview commit SHA·server env **존재 여부만**·Runtime Gate 확인
- [ ] 현재 요약의 두 확인 항목에 최소 펼침형 UI 연결 후 수동 브라우저 클릭 테스트
- [ ] 고객 핵심 요약, 상세 분석, 기존 v1 관리자 기능, 인쇄/PDF 회귀 검증
- [ ] 운영 배포·병합 전 사용자 **명시 승인**

이 Draft의 자동 테스트는 코드 검증일 뿐 실제 로그인된 브라우저 QA나 고객 공개 허가가 아니다.
