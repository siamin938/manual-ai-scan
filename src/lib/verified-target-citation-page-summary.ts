import type { EntityFactsV2ReadGatewayDTO } from "./entity-facts-v2-read-gateway.types";

/**
 * Exact representative Run's PAGE-level citation verification status.
 *
 * The number of verified related citation pages is not a count of all
 * web pages mentioning the business, or of distinct cited domains.
 * Unverified, pending, and complete-with-zero must never be conflated.
 */
export type VerifiedTargetCitationPageSummary = {
  status: "complete" | "pending" | "not_verified";
  label: string;
  count: number | null;
};

export function buildVerifiedTargetCitationPageSummary(
  data: Pick<
    EntityFactsV2ReadGatewayDTO,
    "verifiedTargetCitationPageStatus" | "verifiedTargetCitationPages"
  >,
): VerifiedTargetCitationPageSummary {
  const status =
    data.verifiedTargetCitationPageStatus ??
    (data.verifiedTargetCitationPages !== undefined ? "complete" : "not_verified");

  if (status === "pending") {
    return { status: "pending", label: "확인 중", count: null };
  }

  if (status !== "complete" || data.verifiedTargetCitationPages === undefined) {
    return { status: "not_verified", label: "미검증", count: null };
  }

  const count = data.verifiedTargetCitationPages.length;
  return { status: "complete", label: `${count}개`, count };
}
