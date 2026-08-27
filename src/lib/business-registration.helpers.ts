/**
 * 업체 등록 화면 전용 순수 헬퍼.
 * 판정/스코어링 로직 없음. 표기 정규화와 보수적인 표기 변형 후보만 다룬다.
 */

export function normalizeBusinessName(name: string): string {
  return (name ?? "").normalize("NFKC").trim().replace(/\s+/g, " ");
}

/**
 * 안전한 표기 변형 후보만 생성한다.
 * - 정규화된 공식명 자체는 후보에 포함하지 않는다.
 * - 공백이 있는 경우 '공백만 제거한 전체 이름' 1개만 후보로 만든다.
 * - 단어 삭제/축약/문자 변환은 생성하지 않는다.
 */
export function generateSafeAliasCandidates(name: string): string[] {
  const normalized = normalizeBusinessName(name);
  if (!normalized) return [];

  const candidates: string[] = [];
  if (normalized.includes(" ")) {
    const spaceless = normalized.replace(/ /g, "");
    if (spaceless && spaceless !== normalized) candidates.push(spaceless);
  }

  const seen = new Set<string>();
  return candidates.filter((c) => {
    if (seen.has(c)) return false;
    seen.add(c);
    return true;
  });
}

/** 별칭 목록 정규화: 공백 정규화, 빈 값 제거, 중복 제거(순서 유지). */
export function normalizeAliasList(aliases: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of aliases ?? []) {
    const value = normalizeBusinessName(raw);
    if (!value) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}
