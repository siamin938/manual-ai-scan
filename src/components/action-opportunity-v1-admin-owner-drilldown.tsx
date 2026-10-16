import { useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { ActionOpportunityV1CustomerEvidenceCandidate } from "@/components/action-opportunity-v1-customer-evidence-candidate";
import { getActionOpportunityV1CustomerEvidence } from "@/lib/action-opportunity-v1.customer-read.functions";
import type { CustomerEvidenceInsightId } from "@/lib/action-opportunity-v1.customer-read";
import {
  canRenderV1CustomerEvidenceQa,
  type V1CustomerQaScope,
} from "@/lib/action-opportunity-v1.customer-dashboard-qa-scope";

/**
 * Development-only product-review surface. Mounted ONLY when the dashboard
 * separately verifies the current user as an internal data-asset admin.
 * It does not activate the customer v1 release and is excluded from printing.
 */
export function ActionOpportunityV1AdminOwnerDrilldown({
  scope,
  insightId,
  adminAllowed,
}: {
  scope: V1CustomerQaScope;
  insightId: CustomerEvidenceInsightId;
  adminAllowed: boolean;
}) {
  const panelId = useId();
  const [expanded, setExpanded] = useState(false);
  const fetchEvidence = useServerFn(getActionOpportunityV1CustomerEvidence);
  const evidenceQuery = useQuery({
    queryKey: [
      "action-opportunity-v1-owner-qa",
      scope.userId,
      scope.orgId,
      scope.businessId,
      scope.runId,
      insightId,
    ],
    enabled: expanded && adminAllowed,
    retry: false,
    staleTime: 0,
    queryFn: () => fetchEvidence({
      data: {
        orgId: scope.orgId,
        businessId: scope.businessId,
        expectedRunId: scope.runId,
        insightId,
      },
    }),
  });

  if (!adminAllowed) return null;

  const response = evidenceQuery.data;
  const valid = canRenderV1CustomerEvidenceQa({
    adminAllowed,
    expanded,
    isFetching: evidenceQuery.isFetching,
    selected: scope,
    current: scope,
    insightId,
    response,
  });

  return (
    <div className="no-print">
      <Button
        type="button"
        variant="link"
        size="sm"
        className="mt-1 h-auto px-0 py-1 text-xs"
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={() => setExpanded((wasExpanded) => !wasExpanded)}
      >
        {expanded
          ? "관리자 검수 · 고객용 근거 닫기"
          : "관리자 검수 · 고객용 근거 펼침 테스트"}
      </Button>
      {expanded && (
        <div id={panelId} className="mt-2">
          {evidenceQuery.isPending || evidenceQuery.isFetching ? (
            <p className="rounded-lg border p-3 text-sm text-muted-foreground" role="status">
              현재 대표 측정의 고객용 판단 근거를 확인 중입니다.
            </p>
          ) : valid && response?.ok === true ? (
            <ActionOpportunityV1CustomerEvidenceCandidate detail={response.detail} expandEvidence />
          ) : (
            <p className="rounded-lg border p-3 text-sm text-muted-foreground" role="status">
              이 항목의 현재 대표 측정 근거를 연결하지 않았습니다.
              권한·측정 회차·근거가 모두 일치하는지 확인해 주세요.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
