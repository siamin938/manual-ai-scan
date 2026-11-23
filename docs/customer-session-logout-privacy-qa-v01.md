# 차보임 고객 세션·로그아웃 프라이버시 QA v0.1

상태: 기존 Lovable 연결 개발 브랜치에서 **로그아웃·계정 전환 보호만 최소 수정**. 정식 사이트 Publish 미실행.

## 배경과 발견 사항

기존 `useSession`은 `SIGNED_OUT`에서 React Query 캐시를 비웠지만
업체 선택 키(`ai-visibility-lab.target-business.*`)는 같은 브라우저의 localStorage에 남았다.
해당 UUID만으로 다른 조직 측정을 직접 읽을 수는 없고 서버/DB 조직 멤버십 검사는 유지된다.
그럼에도 같은 장치에서 다른 사용자가 로그인할 때 이전 사용자의 선택값을 재사용하지 않도록 한다.

또한 원래 초기 `auth.getSession()` Promise가 새 auth 이벤트보다 늦게 종료될 때
이전 결과로 로컬 세션을 다시 덮어쓸 수 있는 타이밍을 피한다.
다른 탭에서 로그아웃해 인증된 라우트가 이미 렌더된 상황에는
클라이언트도 `/auth`로 이동하고 이전 조직 온보딩을 렌더하지 않는다.

## 보호 장치

1. `SIGNED_OUT`: React Query 캐시 초기화 + 차보임 대상 업체 selection key만 삭제.
   Supabase auth token 등 다른 localStorage 키는 건드리지 않음.
2. 로그인 사용자 ID 변경: 동일한 초기화. `TOKEN_REFRESHED`가 **같은 사용자**인 경우 선택값 유지.
3. 초기 `getSession` 비동기 완료: 중간에 새로운 인증 이벤트가 도착했으면 오래된 초기 응답은 무시.
4. `OrgProvider`는 session.user.id로 React key 분리. 사용자 변경 시 조직/업체 React 상태 재시작.
5. 다른 탭에서 SIGNED_OUT 발생: 세션이 없어지면 인증된 화면 대신 로그인 페이지로 이동.
6. 기존 서버 `requireSupabaseAuth` / RLS 조직 멤버십 / 서버 현재 대표 Run 체크는 **그대로 유지**.

## 코드 및 자동 QA

- `src/lib/session-privacy.ts`: 순수 세션 전환 판별, prefix-only 업체 선택 정리
- `src/lib/active-business.tsx`: 기존 업체 선택 prefix 상수 공유
- `src/lib/org.tsx`: 명시적 로그아웃/사용자 변경 시 캐시+selection 정리, 세션 경쟁상태 차단
- `src/routes/_authenticated/route.tsx`: 계정별 provider 격리, 인증 해제 시 안전한 로그인 이동
- `tests/entity-engine-v2/customer-session-privacy.test.ts`: 순수 로직(같은 사용자/전환/로그아웃/스토리지 예외)
- 기존 `customer-auth-tenant-isolation.contract.test.ts`: 보호 동작 회귀 검증

## 실제 로그인 E2E Gate (미검증)

- [ ] 현재 관리자 계정에서 업체 선택 후 로그아웃 → 로그인 화면 표시, 업체/진단 데이터 잔류 없음
- [ ] 같은 계정으로 다시 로그인 → 저장된 선택 업체 ID가 재사용되지 않고 정상 기본 선택
- [ ] 다른 브라우저 탭에서 로그아웃 → 열린 차보임 탭도 로그인 페이지로 전환, 고객 데이터 미노출
- [ ] 별도 일반 고객 `client_viewer` 계정(현재 프로젝트에 없음): 관리자 메뉴·근거 QA 도구 미표시
- [ ] 다른 조직 회원 간 계정 전환: 이전 조직 캐시/업체 선택이 재사용되지 않는지
- [ ] 유효한 세션의 평상시 토큰 갱신: 선택 업체·현재 진단 화면 유지

**자동 테스트는 실제 브라우저/고객 계정 QA를 대체하지 않는다.**
계정 추가, 기존 사용자 역할 변경, RLS/DB 수정, 측정/크레딧 차감,
비밀키 출력, Lovable 운영 Publish와 PR 병합은 금지.
