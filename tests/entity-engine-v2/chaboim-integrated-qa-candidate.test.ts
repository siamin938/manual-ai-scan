import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  canDisplayHistoryDetail,
  type MeasurementHistoryDetailResponse,
} from "../../src/lib/measurement-history.model";
import { canRenderV1CustomerEvidenceQa } from "../../src/lib/action-opportunity-v1.customer-dashboard-qa-scope";
import type { CustomerEvidenceReadResponse } from "../../src/lib/action-opportunity-v1.customer-read";
import type { EntityFactsV2ReadGatewayDTO } from "../../src/lib/entity-facts-v2-read-gateway.types";

const orgId = "11111111-1111-4111-8111-111111111111";
const businessId = "22222222-2222-4222-8222-222222222222";
const currentRunId = "33333333-3333-4333-8333-333333333333";
const archivedRunId = "44444444-4444-4444-8444-444444444444";
const userId = "55555555-5555-4555-8555-555555555555";
const insightId = "broad_scope_gap" as const;

function archivedResponse(): MeasurementHistoryDetailResponse {
  return {
    ok: true,
    data: {
      orgId,
      businessId,
      runId: archivedRunId,
      report: {
        business: { id: businessId },
        scope: { runId: archivedRunId },
      } as unknown as EntityFactsV2ReadGatewayDTO,
    },
  };
}

function currentEvidenceResponse(runId = currentRunId): CustomerEvidenceReadResponse {
  return {
    ok: true,
    scope: { orgId, businessId, runId, insightId },
    detail: {
      title: "이번 측정의 관찰 결과",
      recommendedCheck: "공개 정보 확인",
      observation: "이번 측정에 저장된 사실",
      explanation: "인과관계를 뜻하지 않습니다.",
      evidence: [{ label: "기준 검색 확정", value: "0/8" }],
      disclaimer: "관찰 결과일 뿐입니다.",
    },
  };
}

describe("CHABOIM integrated draft: historical Run plus admin-only owner evidence", () => {
  it("permits an exact historical result without treating it as the current Run", () => {
    const history = archivedResponse();
    expect(canDisplayHistoryDetail({
      orgId, businessId, runId: archivedRunId, response: history,
    })).toBe(true);
    expect(canDisplayHistoryDetail({
      orgId, businessId, runId: currentRunId, response: history,
    })).toBe(false);

    // A stored historic Run may exist, but customer-v1 owner evidence is
    // ALWAYS pinned to the latest representative Run.
    const current = { userId, orgId, businessId, runId: currentRunId };
    expect(canRenderV1CustomerEvidenceQa({
      adminAllowed: true,
      expanded: true,
      isFetching: false,
      selected: current,
      current,
      insightId,
      response: currentEvidenceResponse(archivedRunId),
    })).toBe(false);
    expect(canRenderV1CustomerEvidenceQa({
      adminAllowed: true,
      expanded: true,
      isFetching: false,
      selected: current,
      current,
      insightId,
      response: currentEvidenceResponse(),
    })).toBe(true);
  });

  it("fails closed across organization and business changes in both views", () => {
    const history = archivedResponse();
    for (const scope of [
      { orgId: "other-org", businessId },
      { orgId, businessId: "other-business" },
    ]) {
      expect(canDisplayHistoryDetail({
        ...scope, runId: archivedRunId, response: history,
      })).toBe(false);
    }

    const selected = { userId, orgId, businessId, runId: currentRunId };
    for (const current of [
      { ...selected, userId: "other-user" },
      { ...selected, orgId: "other-org" },
      { ...selected, businessId: "other-business" },
      { ...selected, runId: archivedRunId },
    ]) {
      expect(canRenderV1CustomerEvidenceQa({
        adminAllowed: true,
        expanded: true,
        isFetching: false,
        selected,
        current,
        insightId,
        response: currentEvidenceResponse(),
      })).toBe(false);
    }
  });

  it("registers the history route and preserves existing owner dashboard boundaries", () => {
    const load = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
    const nav = load("src/routes/_authenticated/route.tsx");
    const generated = load("src/routeTree.gen.ts");
    const dashboard = load("src/routes/_authenticated/dashboard.tsx");
    const historyView = load("src/routes/_authenticated/measurement-history.tsx");
    const historyServer = load("src/lib/measurement-history.functions.ts");
    const ownerServer = load("src/lib/action-opportunity-v1.customer-read.functions.ts");
    const ownerQa = load("src/components/action-opportunity-v1-admin-owner-drilldown.tsx");

    expect(nav).toContain('{ to: "/measurement-history", label: "측정 기록" }');
    expect(generated).toContain("AuthenticatedMeasurementHistoryRoute");
    expect(generated).toContain("'/measurement-history'");
    expect(historyView).toContain("listMeasurementHistory");
    expect(historyView).toContain("getMeasurementHistoryDetail");
    expect(historyView).toContain("canDisplayHistoryDetail({");
    expect(historyServer).toContain(".middleware([requireSupabaseAuth])");

    expect(dashboard).toContain("getEntityFactsV2ReadGateway");
    expect(dashboard).toContain("getActionOpportunityV1DashboardPrivatePreview");
    expect(dashboard).toContain("customerEvidenceQaScope={");
    expect(dashboard).toContain("privateV1AdminAllowed &&");
    expect(dashboard).toContain("<ActionOpportunityV1AdminOwnerDrilldown");
    expect(dashboard).toContain("이번 측정에서 확인할 ");
    expect(dashboard).toContain("print-report");

    expect(ownerQa).toContain('className="no-print"');
    expect(ownerQa).toContain("enabled: expanded && adminAllowed");
    expect(ownerServer).toContain(".middleware([requireSupabaseAuth])");
    expect(ownerServer).toContain("gateway.data.scope.runId !== data.expectedRunId");

    // Archive and current-run evidence are deliberately separate server APIs.
    expect(historyView).not.toContain("getActionOpportunityV1CustomerEvidence");
    expect(dashboard).not.toContain("getMeasurementHistoryDetail");
    expect(ownerQa).not.toContain("getMeasurementHistoryDetail");

    for (const server of [historyServer, ownerServer]) {
      for (const forbidden of [
        ".insert(", ".update(", ".delete(", ".upsert(",
        "enqueueRun(", "startMeasurement(", "measurement_credit_accounts",
      ]) {
        expect(server).not.toContain(forbidden);
      }
    }
  });
});
