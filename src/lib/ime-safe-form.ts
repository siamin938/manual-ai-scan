/**
 * IME(한글 등 조합형 입력) 안전 폼 헬퍼.
 *
 * 목적:
 * - 조합 중(composition) 마지막 글자가 React state에 커밋되기 전에 submit이 실행되어
 *   값이 누락되는 race condition을 구조적으로 제거한다.
 * - 저장 시점에 폼 DOM의 최신 값을 snapshot으로 확정한다.
 *
 * 판정/스코어링 등 도메인 로직은 포함하지 않는 순수 UI 헬퍼다.
 */

export type ImeEventLike = {
  keyCode?: number;
  nativeEvent?: { isComposing?: boolean; keyCode?: number } | null;
};

/** Enter 제출 경로에서 조합 중인지 판단한다. (isComposing 또는 legacy keyCode 229) */
export function isImeComposingEvent(event: ImeEventLike | null | undefined): boolean {
  if (!event) return false;
  const native = event.nativeEvent ?? null;
  if (native && native.isComposing === true) return true;
  if (native && native.keyCode === 229) return true;
  if (event.keyCode === 229) return true;
  return false;
}

export type FormFieldElementLike = {
  name?: string;
  value?: unknown;
  type?: string;
};

export type FormElementsLike = {
  elements?: ArrayLike<FormFieldElementLike> | null;
} | null;

/**
 * 폼 DOM에서 지정한 name의 텍스트 값 snapshot을 읽는다.
 * - 존재하지 않거나 문자열이 아닌 필드는 결과에서 제외한다(호출부의 기존 state가 유지되도록).
 */
export function readTextFieldSnapshot<Name extends string>(
  form: FormElementsLike,
  names: readonly Name[],
): Partial<Record<Name, string>> {
  const out: Partial<Record<Name, string>> = {};
  const elements = form?.elements;
  if (!elements) return out;

  const wanted = new Set<string>(names);
  const byName = new Map<string, string>();
  for (let i = 0; i < elements.length; i += 1) {
    const el = elements[i];
    if (!el) continue;
    const name = typeof el.name === "string" ? el.name : "";
    if (!name || !wanted.has(name)) continue;
    if (el.type === "checkbox" || el.type === "radio") continue;
    if (typeof el.value !== "string") continue;
    if (!byName.has(name)) byName.set(name, el.value);
  }
  for (const name of names) {
    const value = byName.get(name);
    if (value !== undefined) out[name] = value;
  }
  return out;
}

/**
 * 기존 값 객체에 DOM snapshot을 병합한다. snapshot에 있는 키만 덮어쓴다.
 */
export function mergeFieldSnapshot<T extends Record<string, unknown>>(
  current: T,
  snapshot: Partial<Record<keyof T & string, string>>,
): T {
  const merged: Record<string, unknown> = { ...current };
  for (const [key, value] of Object.entries(snapshot)) {
    if (typeof value === "string") merged[key] = value;
  }
  return merged as T;
}
