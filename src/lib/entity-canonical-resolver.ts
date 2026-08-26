/**
 * Canonical Entity Resolver — UI/DTO contract only.
 *
 * CORE ENGINE ISOLATION
 * - 이름 정규화 / core variant / 강한 이름 관계 판정 / URL 근거 정규화 /
 *   병합(union-find) / 대표 display name 선택 / reason code 생성 / persistence는
 *   Supabase Edge Function `entity-canonical-resolver`가 전담한다.
 * - 이 모듈에는 판정 규칙이나 heuristic 상수를 두지 않는다.
 * - 남아 있는 것은 화면 렌더링과 버전 계약에 필요한 비민감 타입뿐이다.
 */

/** Resolver version contract used to read back stored canonical rows. */
export const RESOLVER_VERSION = "0.1.0";

export type CanonicalResolutionStatus =
  | "matched_business"
  | "merged"
  | "standalone"
  | "needs_review";

export type CanonicalConfidence = "high" | "medium" | "low";

/** Safe aggregate summary returned by the Edge Function wrapper. */
export type CanonicalResolutionSummary = {
  resolverVersion: string;
  candidateCount: number;
  insertedCount: number;
  skippedCount: number;
  matchedBusinessCount: number;
  mergedCount: number;
  standaloneCount: number;
};
