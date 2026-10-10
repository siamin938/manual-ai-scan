# 차보임 고객 로그인·계정 보안 QA (2026-10-10)

## 점검 범위와 불변 조건

- 개발 브랜치: feat/action-opportunity-v01-dry-run, PR #11 (Draft).
- 운영 Supabase 프로젝트 qoirkwmnyolquvsgbian: 메타데이터 읽기 전용 확인.
- 신규 회원가입, 비밀번호 변경, AI 측정, 측정권 차감, SQL 변경, Edge 배포, 프로덕션 배포/PR 병합 없음.
- 코드 변경: SIGNED_OUT 시 React Query 캐시 제거 및 조직·업체 접근 가드 회귀 테스트 추가.

## 근거가 확인된 항목

- src/routes/auth.tsx: SELF_SIGNUP_ENABLED=false, 재설정 링크 수신/폼 화면은 사용자 시연 확인.
- src/routes/_authenticated/route.tsx: getUser()로 보호된 라우트 진입 검증.
- 서버 read 함수는 auth middleware와 현재 userId/orgId 멤버십을 확인한 후 고객 데이터를 조회.
- privileged Read Gateway: businessId 와 orgId 모두 일치하고 활성 고객 업체인지 검사.
- 관리자 v1 비공개 미리보기: 별도 admin RPC와 동일 조직의 사용자 멤버십을 확인.
- 운영 DB public 기본/파티션 테이블 54개 전부 RLS enabled. 비활성 RLS 테이블 0개.
- 보안 Advisor의 SECURITY DEFINER 경고 8건은 함수 정의에서 현재 auth.uid / 관리자·조직 검사를 발견. 익명 EXECUTE 권한이 열린 public SECURITY DEFINER 함수는 없음.
- RLS ON 상태에서 일반 정책 없음 26개는 서비스 전용 테이블로 보이는 격리 상태. 의도 여부는 추후 검토 필요.

## 새 CI 계약 테스트의 범위

- tests/entity-engine-v2/customer-auth-tenant-isolation.contract.test.ts는 로그인·가입·복구·로그아웃, 고객 데이터 서버 조직 검증, 사업장 소속 검증, 관리자 전용 접근 경계를 소스 수준에서 감시.
- **소스 계약 테스트는 다른 계정으로 실제 API를 호출하는 부정 테스트를 대체하지 않음.**

## 실제 고객 계정으로 확인할 부분 (미진행)

- [ ] 고객 A 로그인 → 자기 조직의 진단·업체만 표시되는지 확인.
- [ ] 고객 B 세션에서 고객 A 조직·업체 ID를 바꿔 요청해도 결과가 거부되는지 검증.
- [ ] 일반 고객이 내부 관리자 URL 직접 접근 시 데이터를 받을 수 없는지 확인.
- [ ] 실제 비밀번호 변경 후 새 비밀번호 로그인/이전 비밀번호 거부 확인.
- [ ] 로그아웃·뒤로가기·다른 탭·계정 전환 시 이전 고객 결과가 노출되지 않는지 확인.
- [ ] Supabase Auth 서버의 신규가입 허용이 OFF인지 대시보드에서 확인: 프론트 SELF_SIGNUP_ENABLED=false와 구분.
- [ ] 최신 GitHub SHA와 Lovable Preview 동기화 후 서비스 키 존재 여부와 /dashboard 실행성 확인 (키 값은 출력하지 않음).

## 출시 상태

PR #11 Draft, 고객용 v1.0 공개·병합 금지 유지. 모든 실제 계정 검증 전에는 최종 보안 QA 통과로 표시하지 않음.
