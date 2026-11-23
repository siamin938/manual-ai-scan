import type { EntityFactsV2ReadGatewayDTO } from "./entity-facts-v2-read-gateway.types";
import { buildEntityFactsV2DashboardCutoverModel } from "./entity-facts-v2-read-gateway.dashboard-cutover";
import { buildEntityFactsV2DashboardSummaryViewModel } from "./entity-facts-v2-dashboard-summary.viewmodel";
import { buildUnifiedDiagnosticLayerSummary } from "./unified-diagnostic-layer-summary";
import { isUnifiedDiagnosticSetName } from "./custom-question-suggestions";
import {
  buildCompactSummaryInsights,
  type CompactSummaryInsight,
} from "./dashboard-compact-insights";
import { buildVerifiedTargetCitationPageSummary } from "./verified-target-citation-page-summary";
import { buildActionOpportunityV1Preview } from "./action-opportunity-v1.rules";
import { buildCustomerPreviewV1Model } from "./action-opportunity-v1.customer-preview.viewmodel";
import {
  buildV1CustomerEvidenceCandidate,
  type V1CustomerEvidenceCandidate,
} from "./action-opportunity-v1.customer-release-candidate";

/**
 * Candidate endpoint contract: one requested summary insight and one exact
 * current representative Run. This contract does NOT activate the UI.
 */
export type CustomerEvidenceInsightId = Exclude<
  CompactSummaryInsight["id"],
  "verified_page_present"
>;

const ALLOWED_INSIGHT_IDS: readonly CustomerEvidenceInsightId[] = [
  "zero_confirmed",
  "broad_scope_gap",
  "verified_page_zero",
  "repeated_competitor",
  "top3_unconfirmed",
];

export function isCustomerEvidenceInsightId(
  value: unknown,
): value is CustomerEvidenceInsightId {
  return typeof value === "string" &&
    (ALLOWED_INSIGHT_IDS as readonly string[]).includes(value);
}

export type CustomerEvidenceReadResponse =
  | {
      ok: true;
      scope: {
        orgId: string;
        businessId: string;
        runId: string;
        insightId: CustomerEvidenceInsightId;
      };
      detail: V1CustomerEvidenceCandidate;
    }
  | { ok: false; error: "FORBIDDEN" | "NOT_AVAILABLE" | "INTERNAL_ERROR" };

/**
 * All insight selection and copy is recomputed from the server-read current
 * representative Run. No counts, competitor names, links, evidence, or
 * internal opportunity parameters are accepted from a client.
 *
 * Return ONLY customer-safe fields, never the full internal v1 preview model.
 */
export function buildCustomerEvidenceReadFromCurrentRun(args: {
  userId: string;
  orgId: string;
  businessId: string;
  expectedRunId: string;
  insightId: CustomerEvidenceInsightId;
  dto: EntityFactsV2ReadGatewayDTO;
}): Extract<CustomerEvidenceReadResponse, { ok: true }> | null {
  const { userId, orgId, businessId, expectedRunId, insightId, dto } = args;
  if (!userId || !orgId || !businessId || !expectedRunId ||
    !isCustomerEvidenceInsightId(insightId) ||
    dto.business.id !== businessId ||
    dto.scope.runId !== expectedRunId ||
    dto.overview.validCount <= 0
  ) {
    return null;
  }

  const unifiedLayerSummary =
    dto.scope.questionSetName &&
    isUnifiedDiagnosticSetName(dto.scope.questionSetName) &&
    dto.questionLocations
      ? buildUnifiedDiagnosticLayerSummary({
          questionAreas: dto.questionAreas,
          questionLocations: dto.questionLocations,
          overview: dto.overview,
        })
      : null;

  // Reuse the current customer dashboard's v2 cutover and summary builders;
  // legacy benchmark opportunities do not affect compact summary observations.
  const summary = buildEntityFactsV2DashboardSummaryViewModel({
    model: buildEntityFactsV2DashboardCutoverModel(dto),
    unifiedLayerSummary,
    actionOpportunityModel: null,
    broadSearchObservation: dto.broadSearchObservation ?? null,
  });
  if (summary.businessName !== dto.business.name ||
    summary.measuredAt !== dto.scope.measuredAt ||
    summary.visibility.count !== dto.overview.confirmedMentionCount ||
    summary.visibility.total !== dto.overview.validCount ||
    summary.top3.count !== dto.overview.confirmedTop3Count ||
    summary.top3.total !== dto.overview.validCount
  ) {
    return null;
  }

  // The dashboard shows at most the first two compact observations.
  // Never expose other v1 rules through the customer endpoint.
  const selected = buildCompactSummaryInsights(summary)
    .filter((item) => item.id === insightId);
  if (selected.length !== 1) return null;

  const preview = buildCustomerPreviewV1Model(
    dto,
    buildActionOpportunityV1Preview(dto),
  );
  if (!preview) return null;

  const detail = buildV1CustomerEvidenceCandidate({
    current: {
      userId,
      orgId,
      businessId,
      runId: expectedRunId,
      businessName: summary.businessName,
      measuredAt: summary.measuredAt,
      validCount: summary.visibility.total,
      confirmedCount: summary.visibility.count,
      top3Count: summary.top3.count,
      relatedPageLabel: buildVerifiedTargetCitationPageSummary(dto).label,
    },
    preview: { userId, orgId, businessId, runId: expectedRunId, model: preview },
    insight: selected[0]!,
  });
  if (!detail) return null;

  return {
    ok: true,
    scope: { orgId, businessId, runId: expectedRunId, insightId },
    detail,
  };
}
