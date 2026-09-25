export const CANONICALIZATION_VERSION_CONFLICT = "conflict" as const;

export type CanonicalizationVersionResolution =
  | string
  | null
  | typeof CANONICALIZATION_VERSION_CONFLICT;

export function resolveCanonicalizationVersion(
  rows: readonly { resolver_version: string }[],
): CanonicalizationVersionResolution {
  const versions = new Set(rows.map((row) => row.resolver_version));
  if (versions.size === 0) return null;
  if (versions.size > 1) return CANONICALIZATION_VERSION_CONFLICT;
  return versions.values().next().value ?? null;
}