/**
 * Entity Verification — UI/DTO contract only.
 *
 * CORE ENGINE ISOLATION
 * - 판정 heuristic / regex / descriptor / heading / network / probable 규칙과
 *   persistence는 Supabase Edge Function `entity-verification`이 전담한다.
 * - 이 파일에는 저장된 verification row를 읽는 소비자 측 gate와 표시용 타입만 둔다.
 */

/** 저장된 verification row와 대조할 계약 버전. 판정 규칙은 포함하지 않는다. */
export const ENTITY_VERIFIER_VERSION = "0.1.1";

export type VerificationStatus =
  | "confirmed_business"
  | "rejected_non_business"
  | "needs_review";

export type VerifiedEntityKind =
  | "specific_business"
  | "brand_network"
  | "generic_category"
  | "platform"
  | "advice"
  | "ambiguous";

export type VerificationConfidence = "high" | "medium" | "low";

/** Edge Function이 반환하는 최소 요약 DTO. */
export type EntityVerificationSummary = {
  verifierVersion: string;
  mentionCount: number;
  insertedCount: number;
  skippedCount: number;
  confirmedBusinessCount: number;
  rejectedCount: number;
  needsReviewCount: number;
};

/** UI gate: 저장된 row가 현재 버전의 confirmed business인지만 확인한다. */
export function isVerifiedBusinessMention(
  verification:
    | {
        verifier_version?: string | null;
        verification_status?: string | null;
        verified_count_as_business?: boolean | null;
      }
    | null
    | undefined,
): boolean {
  if (!verification) return false;
  return (
    verification.verifier_version === ENTITY_VERIFIER_VERSION &&
    verification.verification_status === "confirmed_business" &&
    verification.verified_count_as_business === true
  );
}
