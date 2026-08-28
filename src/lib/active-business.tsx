import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { BusinessSelection } from "@/lib/client-business-selection";

/**
 * 인증 영역 전체에서 공유되는 "대상 업체 선택" 상태.
 * - org별로 분리해서 저장하고, 다른 org의 businessId는 절대 재사용하지 않는다.
 * - 여기 저장된 id는 신뢰하지 않고, 사용하는 쪽에서 현재 org의 유효한 업체 목록과 대조한다.
 */
const STORAGE_PREFIX = "ai-visibility-lab.target-business.";

function storageKey(orgId: string) {
  return `${STORAGE_PREFIX}${orgId}`;
}

function readStored(orgId: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    const v = window.localStorage.getItem(storageKey(orgId));
    return v && typeof v === "string" ? v : null;
  } catch {
    return null;
  }
}

function writeStored(orgId: string, businessId: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(orgId), businessId);
  } catch {
    /* storage 사용 불가 환경은 메모리 상태만 사용 */
  }
}

type ActiveBusinessContextValue = {
  /** 현재 org 기준으로 저장된 raw 선택값(검증 전). org가 다르면 null. */
  getSelectedId: (orgId: string | null | undefined) => string | null;
  /** 검증 헬퍼에 넘길 selection 객체. */
  getSelection: (orgId: string | null | undefined) => BusinessSelection;
  select: (orgId: string, businessId: string) => void;
};

const ActiveBusinessContext = createContext<ActiveBusinessContextValue | null>(null);

export function ActiveTargetBusinessProvider({ children }: { children: ReactNode }) {
  const [byOrg, setByOrg] = useState<Record<string, string>>({});

  const getSelectedId = useCallback(
    (orgId: string | null | undefined) => {
      if (!orgId) return null;
      return byOrg[orgId] ?? readStored(orgId);
    },
    [byOrg],
  );

  const value = useMemo<ActiveBusinessContextValue>(
    () => ({
      getSelectedId,
      getSelection: (orgId) => {
        if (!orgId) return null;
        const businessId = getSelectedId(orgId);
        return businessId ? { orgId, businessId } : null;
      },
      select: (orgId, businessId) => {
        if (!orgId || !businessId) return;
        writeStored(orgId, businessId);
        setByOrg((prev) => ({ ...prev, [orgId]: businessId }));
      },
    }),
    [getSelectedId],
  );

  return <ActiveBusinessContext.Provider value={value}>{children}</ActiveBusinessContext.Provider>;
}

export function useActiveTargetBusiness() {
  const ctx = useContext(ActiveBusinessContext);
  if (!ctx)
    throw new Error("useActiveTargetBusiness must be used inside ActiveTargetBusinessProvider");
  return ctx;
}
