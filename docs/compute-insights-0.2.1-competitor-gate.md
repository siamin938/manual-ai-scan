# compute-insights v0.2.1 — competitor substitution 후보 gate (붙여넣기용)

Edge Function `compute-insights` 소스는 이 Lovable 저장소에 없고 Supabase 프로젝트에만 존재합니다.
아래 두 가지만 적용하면 됩니다. Parser v1.2.3 입력/규칙은 수정하지 않습니다.

## 1) 버전 상향 (provenance 분리)

```ts
const ENGINE_VERSION = "0.2.1"; // was 0.2.0
```

기존 0.2.0 insight run은 그대로 보존되고, 같은 run을 다시 postprocess하면
0.2.1로 새 insight run이 생성됩니다.

## 2) buildCompetitorSubstitutionFindings 후보 gate

`matched_business_id`가 null인 미등록 후보에만 적용합니다.
등록된 business/competitor id가 있으면 이 text gate를 절대 적용하지 않습니다.

```ts
const GENERIC_HEADINGS = [
  "우선 고려할 곳", "추천 기준", "확인할 사항", "선택 기준",
  "주의 사항", "주의사항", "참고 사항", "참고사항", "정리하면", "결론", "요약",
];
const QUESTION_MARKERS = [
  "나요", "까요", "습니까", "인가요", "있나요", "없나요", "어떻게", "무엇", "왜 ", "?",
];
const GENERIC_NETWORK_SUFFIXES = [
  "공식서비스네트워크", "서비스네트워크", "공식네트워크", "공식서비스망", "서비스망",
  "정비네트워크", "정비망", "협력망", "지정정비망", "공식정비네트워크", "딜러네트워크", "네트워크",
];
const LONG_TEXT_MIN_LENGTH = 12;

function isObviousNonBusinessName(displayName: string): boolean {
  const text = (displayName ?? "").replace(/\s+/g, " ").trim();
  if (text.length === 0) return true;
  const compact = text.replace(/\s+/g, "");
  if (GENERIC_HEADINGS.some((h) => compact === h.replace(/\s+/g, ""))) return true;
  if (GENERIC_NETWORK_SUFFIXES.some((s) => compact === s || compact.endsWith(s))) return true;
  if (text.length >= LONG_TEXT_MIN_LENGTH && QUESTION_MARKERS.some((mk) => text.includes(mk))) return true;
  return false;
}
```

후보 루프 안에서 (count>=2 / evidence grade / causal=false / priority logic은 그대로):

```ts
// 미등록 후보만 text gate 적용
if (!candidate.matched_business_id && isObviousNonBusinessName(candidate.display_name)) {
  continue;
}
```

기대 결과: `르노코리아 공식 서비스 네트워크`, `우선 고려할 곳`,
`... 있나요` 류는 skip. `가르시아 팩토리`, `진접정비센터`,
`르노코리아 서비스센터 진접정비`, `평택 코스모모터스` 등은 유지.
