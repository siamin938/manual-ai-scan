import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  TARGET_BUSINESS_STORAGE_PREFIX,
  clearStoredTargetBusinessSelections,
  shouldDiscardCustomerState,
} from "../../src/lib/session-privacy";

function storageFrom(values: Record<string, string>) {
  const entries = new Map(Object.entries(values));
  const removed: string[] = [];
  const storage = {
    get length() { return entries.size; },
    key(index: number) { return [...entries.keys()][index] ?? null; },
    removeItem(key: string) { removed.push(key); entries.delete(key); },
  };
  return { storage, entries, removed };
}

describe("CHABOIM auth/tenant state privacy", () => {
  it("invalidates on logout even if the user identity was not yet loaded", () => {
    expect(shouldDiscardCustomerState("SIGNED_OUT", null, null)).toBe(true);
    expect(shouldDiscardCustomerState("SIGNED_OUT", "account-a", null)).toBe(true);
    expect(shouldDiscardCustomerState("SIGNED_OUT", "account-a", "account-a")).toBe(true);
  });

  it("invalidates on identity switch/lost session but not on token refresh", () => {
    expect(shouldDiscardCustomerState("SIGNED_IN", "account-a", "account-b")).toBe(true);
    expect(shouldDiscardCustomerState("TOKEN_REFRESHED", "account-a", "account-b")).toBe(true);
    expect(shouldDiscardCustomerState("USER_UPDATED", "account-a", null)).toBe(true);
    expect(shouldDiscardCustomerState("TOKEN_REFRESHED", "account-a", "account-a")).toBe(false);
    expect(shouldDiscardCustomerState("SIGNED_IN", "account-a", "account-a")).toBe(false);
    expect(shouldDiscardCustomerState("INITIAL_SESSION", null, "account-a")).toBe(false);
    expect(shouldDiscardCustomerState("INITIAL_SESSION", null, null)).toBe(false);
  });

  it("removes every old selected-business key without removing unrelated browser data", () => {
    const org1 = `${TARGET_BUSINESS_STORAGE_PREFIX}org-1`;
    const org2 = `${TARGET_BUSINESS_STORAGE_PREFIX}org-2`;
    const { storage, entries, removed } = storageFrom({
      [org1]: "business-a",
      "unrelated.app.setting": "keep",
      [org2]: "business-b",
      "sb-auth-token": "do-not-touch",
    });
    clearStoredTargetBusinessSelections(storage);
    expect(removed.sort()).toEqual([org1, org2].sort());
    expect([...entries.entries()]).toEqual([
      ["unrelated.app.setting", "keep"],
      ["sb-auth-token", "do-not-touch"],
    ]);
  });

  it("handles disabled browser storage without blocking sign-out", () => {
    expect(() => clearStoredTargetBusinessSelections({
      get length() { throw new Error("storage unavailable"); },
      key: () => null,
      removeItem: () => { throw new Error("unexpected"); },
    })).not.toThrow();

    const orgKey = TARGET_BUSINESS_STORAGE_PREFIX + "org-1";
    expect(() => clearStoredTargetBusinessSelections({
      length: 1,
      key: () => orgKey,
      removeItem: () => { throw new Error("storage denied"); },
    })).not.toThrow();
  });

  it("keeps the session-clearing sequence and isolates each account's providers", () => {
    const read = (file: string) => readFileSync(resolve(process.cwd(), file), "utf8");
    const org = read("src/lib/org.tsx");
    const layout = read("src/routes/_authenticated/route.tsx");
    const stored = read("src/lib/active-business.tsx");

    expect(org).toContain("shouldDiscardCustomerState(event, previousUserId, nextUserId)");
    expect(org).toContain("queryClient.clear()");
    expect(org).toContain("clearStoredTargetBusinessSelections(window.localStorage)");
    expect(org.indexOf("queryClient.clear()")).toBeLessThan(org.indexOf("setSession(nextSession)"));
    expect(org).toContain("if (eventRevision === initialRevision)");
    expect(org).toContain("if (disposed) return;");
    expect(layout).toContain("key={session.user.id}");
    expect(layout).toContain("if (!ready || !session)");
    expect(layout).toContain("if (ready && !session)");
    expect(layout).toContain('navigate({ to: "/auth", replace: true })');
    expect(layout).toContain("await supabase.auth.signOut()");
    expect(stored).toContain("TARGET_BUSINESS_STORAGE_PREFIX");
    expect(stored).not.toContain("window.localStorage.clear()");
    expect(org).not.toContain("window.localStorage.clear()");
  });
});
