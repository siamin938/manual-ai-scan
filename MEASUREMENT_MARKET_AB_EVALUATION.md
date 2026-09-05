# CHABOIM Production vs Shadow 질문 A/B 평가

> 기준일: 2026-09-05
> 상태: **production 미전환 / 신규 업체 적용 후보 검증 완료**

## 목적

기존 production 질문 24개와 측정 시장 표준화 shadow 질문 24개를 실제 등록 업체 기준으로 비교한다.

평가 기준:
1. 실제 업체명을 답하게 만드는 질문인지
2. 표준 8개 intent를 모두 커버하는지
3. 공개 근거로 확인된 핵심 서비스를 빠짐없이 커버하는지
4. 공개 근거가 부족한 검증 대기 서비스를 질문에 강제로 포함하지 않는지
5. 특정 서비스 하나로 과도하게 쏠리지 않는지
6. 동일 intent 안에서 소비자 관점이 실질적으로 다른지
7. target 업체명을 직접 넣거나 노출을 유도하지 않는지

## 공통 결과

Shadow v0.4:
- Provider-Answer Gate v0.1 적용
- Semantic Diversity Gate v0.1 적용
- 8 intent × 3 slots = 24문항
- 현대엑스티어 판교: 24/24 통과, repair 0
- 오토트리: 24/24 통과, repair 0
- 타이어프로 봉일천점: 24/24 통과, repair 0
- 커스텀개러지: 24/24 통과, repair 0

실제 질문 저장/측정/측정권 차감은 하지 않았다.

## 현대엑스티어 판교

### Production
- Provider-answerable: 21/24
- 표준 canonical intent: 8/8
- 핵심 서비스 커버리지: 1/2
- 인접시장 커버리지: 1/1
- 단일 서비스 최대 점유: 83.3%
- 프리미엄 윤활유/합성유 질문: 0
- 일반 정비 계열 질문: 약 20/24

### Shadow
- Provider-answerable: 24/24
- 표준 canonical intent: 8/8
- 핵심 서비스 커버리지: 2/2
- 인접시장 커버리지: 1/1
- 단일 서비스 최대 점유: 33.3%
- 프리미엄 윤활유/합성유: 8/24
- 일반 정비 인접시장: 8/24
- 나머지는 엔진오일 핵심시장

### 판단

기존 0% 측정 질문은 실제로 일반 정비 시장에 과도하게 편향되어 있었다. Shadow는 공개 근거가 강한 엔진오일/프리미엄 윤활유와 인접 일반 정비를 균형 있게 포함한다.

## 오토트리

### Production
- Provider-answerable: 23/24
- canonical intent: 7/8
- `price_value`: 0
- `informational`: 3
- 공개 근거 핵심 서비스 커버리지: 2/4
- 질문이 썬팅/신차패키지 조합에 사실상 집중
- 단일 감지 서비스 최대 점유: 100%

### Shadow
- Provider-answerable: 24/24
- canonical intent: 8/8
- `price_value`: 3
- 공개 근거 핵심 서비스 커버리지: 4/4
- 썬팅 / 신차패키지 / PPF / 랩핑을 모두 측정
- 단일 서비스 최대 점유: 25%

### 판단

Shadow가 업체의 실제 공개 서비스 범위를 더 잘 반영하고, 기존 질문에서 빠진 PPF/랩핑 시장까지 포함한다.

## 타이어프로 봉일천점

### Production
- Provider-answerable: 23/24
- canonical intent: 7/8
- `price_value`: 0
- `informational`: 3
- 공개 근거 핵심 서비스 타이어: 1/1 커버
- `휠`이 24/24 질문에 함께 포함됨
- 현재 휠은 공개 웹 근거가 부족한 `verification_pending`

### Shadow
- Provider-answerable: 24/24
- canonical intent: 8/8
- `price_value`: 3
- 핵심 서비스 타이어: 1/1 커버
- 검증 대기 휠 질문: 0
- 단일 서비스 업체이므로 타이어 100%지만 Semantic Diversity Gate로 소비자 관점을 분리

### 판단

Shadow는 등록 free-text `타이어/휠`을 그대로 사실로 확정하지 않고 공개 근거가 확인된 타이어만 사용한다. 단일 서비스 특성상 서비스 비중 100%는 정상이며, 의미 다양성은 intent별 consumer angle로 확보한다.

## Semantic Diversity 검토

커스텀개러지처럼 `남양주 + 튜닝` 한 축만 있는 업체에서도 서비스/지역을 거짓으로 늘리지 않고 다음처럼 질문 관점을 분리할 수 있었다.

- 추천: 처음 이용 / 후기·평판 / 전문성·신뢰
- 후기: 실제 후기 / 작업 품질·만족도 / 응대·사후관리
- 비교: 서비스·작업 범위 / 후기·평판 / 접근성·이용 편의
- 가격: 가격 대비 / 비용+포함 작업 / 합리적 선택지 비교

## A/B 결론

현재 검증 표본에서는 **Shadow v0.4가 Production보다 측정 시장 대표성, 서비스 근거 정확성, provider-answerability, intent 균형에서 우월**하다.

특히 기존 production의 구조적 문제:
- free-text category 쏠림
- 공개 근거 없는 서비스 동반 포함 가능
- 가격·가성비 intent 누락 가능
- 일반 조언 또는 비정형 informational 질문 혼입
- 같은 서비스/시장에 과도하게 집중

Shadow v0.4의 개선:
- 표준 서비스 프로필
- 공개 웹 근거
- 8 × 3 시장 포트폴리오
- Provider-Answer Gate
- Semantic Diversity Gate

## 안전한 Production 전환 원칙

1. **기존 측정 완료 업체의 질문 세트 자동 변경 금지**
   - compatible run과 반복 비교 보존
2. **우선 신규 업체의 첫 질문 생성에만 새 방식 적용 후보**
3. 첫 측정 전 고객 질문 수정 정책 유지
4. 질문 수 정확히 24개 유지
5. 첫 Run 이후 질문 세트 고정 유지
6. 신규 Generator 실패 시 기존 정상 Generator로 조용히 fallback하지 말고 fail-closed 또는 명확한 내부 오류 처리 검토
7. market profile / portfolio version을 서버 내부 메타데이터로 기록
8. 기존 고객 결과와 신규 결과를 동일 조건 반복 측정으로 잘못 합치지 않도록 question_set 계약 유지
9. 실제 live 전환은 별도 feature flag/default-off 형태로 먼저 준비

## 다음 단계

Production 코드를 바로 교체하지 않고:

- 신규 `market_profile_v0.2` 기반 질문 생성 경로를 feature flag 뒤에 준비
- 내부 운영 조직에서만 flag ON으로 첫 live-like 질문 생성 검증
- 질문 저장 직전 DTO/validation 계약 확인
- 타입/테스트/build 완료
- 이후 일반 신규 고객 기본 경로로 승격 여부 결정
