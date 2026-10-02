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

/** UI 중복 감지용 식별 키. 표기 정규화 후 영문 대소문자 차이를 무시한다. */
export function businessNameIdentityKey(name: string): string {
  return normalizeBusinessName(name).toLocaleLowerCase("en-US");
}

const DUPLICATE_NAME_MESSAGE =
  "이미 등록된 업체명입니다. 지점이 다른 업체라면 공식 업체명에 지점명을 포함해 주세요.";
const GENERIC_SAVE_ERROR_MESSAGE = "업체 저장 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.";

/** 저장 오류를 고객용 메시지로 변환한다. 내부 constraint/details는 노출하지 않는다. */
export function getBusinessSaveErrorMessage(error: unknown): string {
  const e = (error ?? {}) as { code?: unknown; message?: unknown; details?: unknown };
  const code = typeof e.code === "string" ? e.code : "";
  const text = `${typeof e.message === "string" ? e.message : ""} ${
    typeof e.details === "string" ? e.details : ""
  }`;
  if (code === "23505" || text.includes("businesses_org_id_name_key")) {
    return DUPLICATE_NAME_MESSAGE;
  }
  return GENERIC_SAVE_ERROR_MESSAGE;
}

export const BUSINESS_DUPLICATE_NAME_MESSAGE = DUPLICATE_NAME_MESSAGE;

/** 쉼표/줄바꿈으로 구분된 사용자 입력 별칭을 목록으로 분리한다. */
export function parseAliasInput(input: string): string[] {
  return normalizeAliasList((input ?? "").split(/[,，\n\r]+/));
}

/**
 * 최종 별칭 목록을 만든다.
 * - 기존 별칭 보존 → 사용자가 직접 입력한 별칭 → 공백 제거 안전 후보 순서.
 * - 지점명 추론(본점↔구로점 등)은 하지 않는다.
 * - 공식명 자체는 제외한다.
 */
export function mergeBusinessAliases(
  existing: readonly string[],
  userInput: string,
  name: string,
): string[] {
  const canonical = normalizeBusinessName(name);
  return normalizeAliasList([
    ...(existing ?? []),
    ...parseAliasInput(userInput),
    ...generateSafeAliasCandidates(name),
  ]).filter((a) => a !== canonical);
}

export type PublicUrlNormalization =
  | { ok: true; value: string | null }
  | { ok: false };

/** 선택 입력 공개 URL을 http(s) URL로 정규화한다. 빈 값은 null, 잘못된 값은 실패. */
export function normalizeOptionalPublicUrl(input: string | null | undefined): PublicUrlNormalization {
  const raw = (input ?? "").trim();
  if (!raw) return { ok: true, value: null };
  if (/\s/.test(raw)) return { ok: false };

  let candidate: string;
  if (/^https?:\/\//i.test(raw)) candidate = raw;
  else if (raw.startsWith("//")) candidate = `https:${raw}`;
  else if (/^[a-z][a-z0-9+.-]*:/i.test(raw) && !/^[^:/]+:\d+(\/|$)/.test(raw)) return { ok: false };
  else candidate = `https://${raw}`;

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return { ok: false };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { ok: false };
  const host = url.hostname;
  if (!host || !(host.includes(".") || host === "localhost") || host.startsWith(".") || host.endsWith(".")) {
    return { ok: false };
  }
  if (url.username || url.password) return { ok: false };
  // 입력 의미를 바꾸지 않기 위해 원문 기반 candidate를 유지한다.
  return { ok: true, value: candidate };
}
