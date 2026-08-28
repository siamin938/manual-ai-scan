import { useCallback, useRef } from "react";
import {
  isImeComposingEvent,
  mergeFieldSnapshot,
  readTextFieldSnapshot,
  type ImeEventLike,
} from "@/lib/ime-safe-form";

/**
 * IME 안전 폼 훅.
 * - formRef를 폼 엘리먼트에 연결하면 submit 시점에 DOM 최신 값을 snapshot으로 확정할 수 있다.
 * - 조합(composition) 상태를 추적하고, 조합 종료 값을 즉시 state에 커밋할 수 있게 돕는다.
 */
export function useImeSafeForm<Name extends string>(fieldNames: readonly Name[]) {
  const formRef = useRef<HTMLFormElement | null>(null);
  const composingRef = useRef(false);

  const snapshot = useCallback(
    () => readTextFieldSnapshot(formRef.current as FormElementsLike, fieldNames),
    [fieldNames],
  );

  const resolveLatest = useCallback(
    <T extends Record<string, unknown>>(current: T): T =>
      mergeFieldSnapshot(current, snapshot() as Partial<Record<keyof T & string, string>>),
    [snapshot],
  );

  const compositionProps = useCallback(
    (commit: (value: string) => void) => ({
      onCompositionStart: () => {
        composingRef.current = true;
      },
      onCompositionEnd: (e: { currentTarget: { value: string } }) => {
        composingRef.current = false;
        commit(e.currentTarget.value);
      },
    }),
    [],
  );

  const isComposing = useCallback(
    (event?: ImeEventLike | null) => isImeComposingEvent(event) || composingRef.current,
    [],
  );

  return { formRef, snapshot, resolveLatest, compositionProps, isComposing };
}
