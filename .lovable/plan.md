# /dashboard "진단 요청이 실패했습니다" 원인 진단 (코드 변경 0건)

## 실제 예외
`Error: Missing Supabase environment variable(s): SUPABASE_SERVICE_ROLE_KEY. Connect Supabase in Lovable Cloud.`

## Stack trace
- createSupabaseAdminClient — src/integrations/supabase/client.server.ts:43
- ← proxy get — client.server.ts:66
- ← fetchEntityFactsV2ReadGateway — src/lib/entity-facts-v2-read-gateway.server.ts:156 (진단)
- ← getEntityFactsV2ReadGateway — entity-facts-v2-read-gateway.functions.ts:46
- 동일 오류: fetchEntityFactsV2Comparison — entity-facts-v2-comparison.server.ts:279 ← comparison.functions.ts:44 (이전 측정 비교)

## 원인
- 미리보기 서버 프로세스(PID 144, 14:17 UTC 시작) 환경에 서비스 키가 없음(0건). 명령 실행 환경에는 키가 있음.
- 로그인 확인은 통과한 뒤, 관리자 연결을 만드는 단계에서 실패. 코드 로직 오류 아님.
- questionLocations enrichment, UnifiedDiagnosticLayerSummaryCard 관련 예외는 서버 로그·runtime-errors에 없음. 빌드는 최신(43cfaf7) 기준 OK.
- "The app encountered an error"는 같은 서버 함수 실패가 화면까지 전달된 결과로 보이나, runtime-errors.log가 비어 있어 브라우저 측 스택은 확보되지 않음(외부 인증이라 직접 클릭 재현 불가).

## 재현 조건
- 미리보기 /dashboard → 카스페이스 구로점 선택 → 진단/비교 서버 함수 호출 시 매번 발생. 업체와 무관하게 서비스 키가 필요한 모든 호출에서 발생.

## 승인 시 복구 절차 (소스·DB 변경 없음, 지난번과 동일)
1. 미리보기 런타임에 서비스 키 재주입
2. 미리보기 서버만 재시작 후 새 프로세스에 키 존재 확인(값 미출력)
3. 구로점으로 두 서버 함수 읽기 전용 호출 → 오류 0건 확인
