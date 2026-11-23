import type {
  CustomerEvidenceInsightId,
  CustomerEvidenceReadResponse,
} from "./action-opportunity-v1.customer-read";

/**
 * Frontend fail-closed gate for the INTERNAL ONLY inline customer-evidence QA.
 * Server authorization is mandatory and independent of this render check.
 */
export type V1CustomerQaScope = {
  userId: string;
  orgId: string;
  businessId: string;
  runId: string;
};

export function canRenderV1CustomerEvidenceQa(args: {
  adminAllowed: boolean;
  expanded: boolean;
  isFetching: boolean;
  selected: V1CustomerQaScope;
  current: V1CustomerQaScope;
  insightId: CustomerEvidenceInsightId;
  response: CustomerEvidenceReadResponse | null | undefined;
}): boolean {
  const { adminAllowed, expanded, isFetching, selected, current, insightId, response } = args;
  return adminAllowed &&
    expanded &&
    !isFetching &&
    !!selected.userId &&
    !!selected.orgId &&
    !!selected.businessId &&
    !!selected.runId &&
    current.userId === selected.userId &&
    current.orgId === selected.orgId &&
    current.businessId === selected.businessId &&
    current.runId === selected.runId &&
    response?.ok === true &&
    response.scope.orgId === current.orgId &&
    response.scope.businessId === current.businessId &&
    response.scope.runId === current.runId &&
    response.scope.insightId === insightId;
}
