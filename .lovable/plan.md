# 차보임 사장님용 10초 요약

## 목표
- `/dashboard`를 `한눈에 보기`와 `상세 분석` 두 모드로 나누고 기본 진입을 한눈에 보기로 설정합니다.
- 상세 분석은 현재 화면과 데이터 흐름을 그대로 보존합니다.
- 요약의 모든 숫자와 목록은 현재 선택 업체의 기존 Entity Facts v2 및 기존 화면용 모델만 재사용합니다.

## 구현 범위
1. **모드 전환**
   - `view=summary|detail` 검색 파라미터를 검증해 새로고침과 공유에도 선택을 유지합니다.
   - 값이 없거나 잘못되면 `summary`를 기본값으로 사용합니다.
   - 상단 분할 탭과 하단 `상세 분석 보기 →` 버튼을 같은 URL 상태에 연결합니다.

2. **표현 전용 요약 모델**
   - 기존 dashboard cutover model, unified search-scope summary, action opportunity model을 입력으로 받는 작은 순수 ViewModel을 추가합니다.
   - 확정 노출 수, 상위 3곳 수, 유효 답변 수, 관련 페이지 수, 최다 관찰 업체, 최대 3개 검색 상황, 유효할 때만 검색 범위 3개, 기존 우선 확인 항목 상위 2개, 관련 페이지 최대 3개를 구성합니다.
   - 데이터가 없거나 분리 계약이 유효하지 않으면 임의의 0이나 새 추론 대신 명시적 빈 상태를 반환합니다.

3. **한눈에 보기 UI**
   - 기존 토큰과 Card/Button/Badge를 사용해 헤더, 연한 파란 요약 배너, KPI 4개, 검색 상황·검색 범위 2열, 우선 확인·관련 출처 2열, 상세 전환 버튼을 구성합니다.
   - 모바일에서는 1열 또는 2열로 자연스럽게 접고, 긴 한국어·업체명·페이지 제목은 줄바꿈 또는 말줄임 처리합니다.
   - 기존 업체 선택기를 유지해 업체 변경 시 동일 쿼리 결과로 즉시 다시 렌더링합니다.

4. **상세 화면 보존**
   - 현재 긴 대시보드 JSX를 삭제하거나 단순화하지 않고 `detail` 모드에서 그대로 렌더링합니다.
   - 기존 측정, 판정, 서버 함수, DB, Edge Function, Supabase 코드는 변경하지 않습니다.

5. **검증**
   - 순수 요약 ViewModel 테스트로 기존 진실값 재사용, 정렬·최대 개수, unavailable/빈 상태를 확인합니다.
   - 기본 모드, 탭·버튼 전환, 업체별 하드코딩 부재, 기존 상세 화면 계약 보존을 소스 계약 테스트로 확인합니다.
   - Entity Facts v2 관련 테스트, 전체 테스트, TypeScript 검사, production build를 실행합니다.
   - Preview에서 데스크톱·모바일 렌더링과 `/dashboard?view=summary|detail` 전환을 확인하되, 측정 실행이나 게시·배포는 하지 않습니다.

## 변경 예상 파일
- `src/routes/_authenticated/dashboard.tsx`
- `src/lib/entity-facts-v2-dashboard-summary.viewmodel.ts` (신규)
- `tests/entity-engine-v2/entity-facts-v2-dashboard-summary.viewmodel.test.ts` (신규)
- `tests/entity-engine-v2/entity-facts-v2-dashboard-cutover.test.ts`
- `roadmap.md`

## 안전 기준
- 수치 계산식, 판정 기준, 추천 로직은 새로 만들지 않습니다.
- 업체명·업종·도메인을 하드코딩하지 않습니다.
- 검색 범위 분해는 기존 24문항 계약 검증이 성공한 경우에만 표시합니다.
- 우선 확인 항목은 기존 Action Opportunity 결과의 순서와 문구만 축약 재사용합니다.
- Publish/Deploy, DB 수정, Edge 수정, 신규 측정은 수행하지 않습니다.
