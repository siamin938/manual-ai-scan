/** Server-owned comparison status. Request fingerprints remain private. */
export type VisibilityComparisonDTO = {
  compatibleRunCount: number;
  status: "verified" | "single" | "unverified" | "unavailable";
};
