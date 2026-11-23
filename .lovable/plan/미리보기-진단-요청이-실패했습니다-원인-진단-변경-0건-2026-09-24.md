# 미리보기 "진단 요청이 실패했습니다." 원인 진단 (변경 0건)

## 원인
- 실패 요청: 서버 함수 `getEntityFactsV2ReadGateway` (진단) 및 `getEntityFactsV2Comparison` (비교) — 둘 다 실패
- 오류: `Missing Supabase environment variable(s): SUPABASE_SERVICE_ROLE_KEY`
- 위치: client.server.ts:43 (createSupabaseAdminClient) ← read-gateway.server.ts:140 / comparison.server.ts:277
- 미리보기 서버 프로세스(vite PID 186, 04:55 시작)의 환경에 서비스 키가 없음. 명령 실행 환경에는 키가 있음 → 브랜치 전환 후 서버가 키 없이 재시작된 것
- 코드·로그인 세션·빌드 문제 아님 (인증 통과 후 관리자 연결 생성 단계에서 실패). 대시보드 파일 복원과 무관

## 참고
- 현재 작업 브랜치: edit/edt-ae7882e7..., HEAD 8359f5d, 작업 트리 clean

## 승인 시 복구 절차 (소스·DB 변경 없음)
1. 미리보기 런타임에 서비스 키 재주입
2. 미리보기 서버만 재시작 후 새 프로세스에 키 존재 확인(값 미출력)
3. 카스페이스 구로점으로 두 서버 함수 읽기 전용 호출 → 오류 0건 확인
