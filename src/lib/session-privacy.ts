/**
 * Session and tenant-private browser-state lifecycle.
 *
 * Changing the authenticated identity or signing out invalidates customer
 * query caches and the locally remembered business selection. Token refresh
 * and re-sign-in notifications for the SAME user must not erase preferences.
 */
export function shouldDiscardCustomerState(
  event: string,
  previousUserId: string | null,
  nextUserId: string | null,
): boolean {
  return event === "SIGNED_OUT" ||
    (previousUserId !== null && previousUserId !== nextUserId);
}

export const TARGET_BUSINESS_STORAGE_PREFIX = "ai-visibility-lab.target-business.";

type StoredSelectionKeys = Pick<Storage, "length" | "key" | "removeItem">;

/** Delete only this app's selected-business keys; never touch Supabase tokens. */
export function clearStoredTargetBusinessSelections(storage: StoredSelectionKeys): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (key?.startsWith(TARGET_BUSINESS_STORAGE_PREFIX)) keys.push(key);
    }
    for (const key of keys) storage.removeItem(key);
  } catch {
    // Private-browsing/quota/storage restrictions should not block sign-out.
  }
}
