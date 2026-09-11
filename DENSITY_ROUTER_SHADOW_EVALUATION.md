# Evidence Density Router Shadow A/B Evaluation

기준일: 2026-09-11

## 목적

Evidence Density Router를 고객 Action v2 경로에 연결하기 전에, 기존 추천 진위 판정과 threshold를 변경하지 않은 상태에서 source candidate envelope이 실제로 어떻게 달라지는지 shadow로 비교한다.

핵심 원칙:
- Hard Gate 변경 금지
- Truth verification 변경 금지
- 특정 업체 하드코딩 금지
- sparse에서도 약한 신호의 최대 등급은 `observe_more`
- dense는 표준 production 후보를 제거하지 않고 강한/반복 근거의 정렬 우선순위만 높인다
- 고객 화면 영향 없음 (`customerImpact=false`)

## 구현

- `get_measurement_evidence_density_router_v01`
  - sparse: `expand_verified_observation`
  - balanced: `standard_evidence_mix`
  - dense: `focus_strong_and_repeated`
  - insufficient: `hold_for_more_data`
- `get_density_shadow_sparse_source_candidates_v01`
  - production truth gate를 그대로 통과한 `core/notable` 경쟁업체와 actionable attribution만 사용
  - 기존 production 표시 기준 3답변 이상보다 한 단계 약한 `2답변 + 2개 이상 검색상황 + 내 업체 연결 0` 후보만 shadow에서 관찰
  - 고객 Action에는 연결하지 않음
- `get_visibility_density_shadow_ab_v01`
  - Action v2 전체 Top4를 복제하지 않고 Router가 직접 조절 가능한 source candidate envelope만 비교
- `visibility_density_shadow_evaluations`
  - service-role 전용 snapshot 저장
- `get_visibility_density_shadow_ab_summary_v01`
  - 최신 업체별 shadow 결과 요약

## 초기 A/B 결과

최신 측정 기준 업체 7곳:
- dense: 3
- balanced: 3
- sparse: 1
- insufficient: 0

최종 evaluator v0.1.1 결과:
- material change: 0 / 7
- added source candidate: 0
- suppressed source candidate: 0
- summary decision: `hold_shadow_no_material_candidate_change`

즉 현재 데이터에서는 Router를 Action v2에 연결해도 source 후보 집합 자체를 개선한다는 증거가 아직 없다.

## 중요 수정 기록

초기 evaluator v0.1은 dense 환경의 1회 측정 source 후보를 모두 약한 신호로 보고 억제하는 가정을 두었다. 액슬론 모터 스튜디오 데이터에서 이 가정이 잘못됨을 확인했다.

예:
- `modegarage.co.kr`: 경쟁업체 연결 답변 11개, 검색상황 6개, 내 업체 연결 0
- `bdsmartcar.com`: 경쟁업체 연결 답변 10개, 검색상황 7개, 내 업체 연결 0

따라서 dense의 의미는 "1회 측정 후보 제거"가 아니라:
- 표준 production 후보 유지
- threshold 아래 weak expansion은 하지 않음
- strong / repeated evidence의 정렬 우선순위만 강화

으로 수정했다.

## 현재 결론

Density Router는 계속 shadow/default-off로 유지한다.

Action v2 production 연결 조건은 향후 데이터에서 다음 중 하나가 실제로 나타난 뒤 다시 검토한다.
- sparse에서 production 기준 아래지만 truth gate를 통과한 유용한 `observe_more` 후보가 반복적으로 발견됨
- dense에서 후보 집합은 유지하면서 strong/repeated 우선 정렬이 고객 결과 품질을 명확히 개선함
- 충분한 신규 업체 표본에서 material change가 관찰되고 수동 검토 결과가 더 낫다고 판단됨

현재는 고객 경로를 변경하지 않는다.
