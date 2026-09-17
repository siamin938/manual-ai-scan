import type { VisibilityComparisonDTO } from "./visibility-comparison.types";

/** Validate the common RPC result's presentation contract; never infer compatibility. */
export function parseVisibilityComparison(value: unknown): VisibilityComparisonDTO | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const count = row["compatibleRunCount"];
  const status = row["status"];
  if (typeof count !== "number" || !Number.isInteger(count) || count < 0) return null;
  if (status === "verified" && count >= 2) return { compatibleRunCount: count, status };
  if (status === "single" && count === 1) return { compatibleRunCount: count, status };
  if ((status === "unverified" || status === "unavailable") && count === 0) {
    return { compatibleRunCount: count, status };
  }
  return null;
}
