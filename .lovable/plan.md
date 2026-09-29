# /dashboard "진단 요청이 실패했습니다" 원인 진단 (변경 0건)

## 원인
- 새 코드(targetExposureCitationSources / measurement_entity_facts_v2 보조 조회)가 아니라, 미리보기 서버에 서비스 키(SUPABASE_SERVICE_ROLE_KEY)가 빠진 채 기동된 것이 원인입니다. 이전 커밋들과 같은 패턴입니다.
- 실제 오류: `Error: Missing Supabase environment variable(s): SUPABASE_SERVICE_ROLE_KEY`
- 스택:
  - src/integrations/supabase/client.server.ts:43 (createSupabaseAdminClient) ← :66
  - src/lib/entity-facts-v2-comparison.server.ts:336 (fetchEntityFactsV2Comparison) ← entity-facts-v2-comparison.functions.ts:44
  - 같은 오류가 entity-facts-v2-read-gateway.functions.ts(getEntityFactsV2ReadGateway) 경로에서도 반복 기록됨 (로그 12건 이상)
- 관리자 연결 생성 단계에서 실패하므로 read-gateway.server.ts:672의 measurement_entity_facts_v2 조회까지 도달하지 못합니다. 신규 조회 경로의 오류 기록은 0건입니다.

## 런타임 상태
- 키 누락 프로세스: PID 142 (14:50 UTC 기동)
- 키 존재 프로세스: PID 1388 (15:00 UTC 새로 기동)
- 현재 HEAD는 3b0fa46 "Work in progress" (60fdf44의 바로 다음 커밋, 60fdf44 포함). 작업 트리 clean.

## 승인 시 복구 절차 (소스·DB·배포 변경 없음)
1. 기존 시크릿 재연결 후 미리보기 서버만 재시작
2. 새 프로세스 전체에 키 존재 확인 (값 미출력)
3. /dashboard 200 및 재시작 이후 키 누락 로그 0건 확인
4. 이후에도 오류가 남으면 그때 신규 보조 조회 경로를 별도 점검
