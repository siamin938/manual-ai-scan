# Core Engine Isolation Boundary Audit v2 (읽기 전용 감사 결과)

이번 문서는 감사 보고서입니다. 코드 변경/삭제/배포는 하지 않았고, 새로운 규칙 목록이나 세부 임계값을 여기에 추가하지도 않았습니다.

## 1. 등급 분류 요약

| 파일 | 등급 | 근거 |
| --- | --- | --- |
| entity-verification.ts | A | 실제 오류 사례(제목·질문문·브랜드 네트워크가 업체로 집계됨)에서 축적된 bespoke 판정 heuristic. 고객이 보는 "경쟁업체/언급업체" 결과를 직접 바꾼다. |
| entity-verification.server.ts | B | 조회·저장 orchestration 자체는 범용이지만, 순수 판정 모듈과 함께 이동하는 편이 자연스럽다. |
| entity-canonical-resolver.ts | A | 어떤 언급이 같은 업체인지 병합하는 판정 규칙. 중복 집계 여부가 고객 수치에 직접 반영된다. |
| entity-canonical-resolver.server.ts | B | 위와 동일 사유(persist 계층). |
| mention-business-filter.ts (+test) | A로 취급 (사실상 레거시) | 남아 있는 동안은 Entity Verification과 같은 성격의 판정 규칙이며, 테스트가 규칙을 그대로 노출한다. |
| first-party-source-classifier.ts | 대부분 C, 일부 B | URL canonicalization·매치 모드 우선순위는 범용 기술 정제. 특정 플랫폼(Naver Place/Blog) 취급 부분만 제품 품질 지식(B). |
| first-party-source-classification.helpers.ts / server.ts | C | registry row → classifier 입력 매핑과 저장. 판정 자체는 classifier에 있음. |
| question-suggestions.ts | C | 길이·intent 화이트리스트·정규화 dedupe·업체명 포함 시 기본 해제는 입력 검증/UX 안전장치 수준. |
| insights.tsx / reports.manual.tsx priority 표시 구간 | C | DB의 priority_score를 라벨/배지로 바꾸는 presentation. 점수 자체를 만들지 않는다. |

## 2. 질문별 답변

1) **Entity Verification = A, Canonical Resolver = A.** 둘 다 "무엇을 업체로 셀지"와 "무엇을 같은 업체로 볼지"를 결정하며, 이는 경쟁업체 카드·인사이트·실험 결과로 전파되는 최종 판정이다. 외부에서 코드를 보면 한국어 AI 답변 파싱 품질을 상당 부분 재현할 수 있다.

2) **mention-business-filter는 여전히 실제 경로에서 쓰인다** — `src/routes/_authenticated/runs.$runId.tsx`가 `aggregateBusinessShare` / `isConfirmedBusinessMention`을 import해 운영자용 실행 상세 화면에서 사용한다. 같은 화면이 이미 `measurement_entity_verifications` / `measurement_entity_canonicalizations` 결과도 읽고 있어, 판정 성격은 Entity Verification과 **중복(레거시)** 이다. 따라서 제거보다는 "저장된 verification/canonicalization 결과 기반 집계로 교체" 후보다. 집계(카운트·share 계산) 부분만 클라이언트에 남기고, 판정 부분은 남기지 않는 방향이 맞다.

3) **First-party classifier의 MATCH_PRIORITY는 핵심 IP가 아니다.** exact > prefix > host 우선순위는 URL 매칭의 관례적 특정성 순서이고, canonicalization도 범용이다. Naver Place/Blog 취급은 "어떤 플랫폼을 first-party로 인정하는가"라는 제품 정책이라 B 정도이며, 단독으로는 경쟁력 유출이 크지 않다.

4) **question-suggestions 필터는 핵심 IP가 아니다(C).** Edge Function 응답을 신뢰하지 않는 형태 검증 + 중복 제거 + 대상 업체명이 들어간 질문을 기본 해제하는 UX 안전장치이며, 질문 생성 규칙 자체는 이미 Edge Function에 있다.

5) **priority 표시 구간은 presentation(C).** 두 화면 모두 점수를 만들지 않고 DB 값을 사람이 읽는 라벨로 변환할 뿐이다. 다만 insights와 reports.manual의 구간이 서로 다르다는 일관성 이슈는 있고, 이는 보안 문제가 아니라 UX 문제다.

6) **현재 실행 위치 (모두 `src/lib/run-postprocess.functions.ts` 안, 인증된 server function 내부 dynamic import):**
   - Entity Verification: step `entityVerification` → `entity-verification.server.ts`의 persist 함수. 판정 자체는 Lovable 저장소의 순수 모듈에서 실행됨.
   - Canonical Resolver: step `entityCanonicalization` → `entity-canonical-resolver.server.ts`. 동일하게 Lovable 내부 실행.
   - First-party Classification: step `sourceClassification` → `first-party-source-classification.server.ts` → `first-party-source-classifier.ts`. 역시 Lovable 내부 실행.
   - 대비: reparse / profile coverage / insights는 이미 Supabase Edge Function 호출이다. 즉 세 단계만 아직 Lovable 안에서 판정한다.

## 3. 다음 격리 작업 우선순위 제안

1. **Entity Verification 격리** — 가장 상류 판정이며 모든 하류 수치(경쟁업체, 인사이트, 실험)에 영향. Lovable 측은 run-postprocess에서 최소 식별자만 보내고 요약 카운트만 받는 기존 패턴을 재사용.
2. **Canonical Resolver 격리** — Verification 결과에 의존하므로 같은 Edge 경계 뒤에 두는 것이 자연스럽고, 1번과 함께 또는 직후에 진행.
3. **mention-business-filter 정리** — 1·2번 완료 후 운영자 화면을 저장된 verification/canonicalization 결과 기반으로 전환하여 중복 판정 규칙과 그 테스트를 저장소에서 없앤다.

이후(선택) first-party 플랫폼 인정 정책만 서버로 옮기는 정도가 남고, question-suggestions와 priority 표시는 그대로 두어도 무방하다.
