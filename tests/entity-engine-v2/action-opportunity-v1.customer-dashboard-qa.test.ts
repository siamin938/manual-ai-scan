import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  canRenderV1CustomerEvidenceQa,
  type V1CustomerQaScope,
} from "../../src/lib/action-opportunity-v1.customer-dashboard-qa-scope";
import type { CustomerEvidenceReadResponse } from "../../src/lib/action-opportunity-v1.customer-read";

const userId = "11111111-1111-4111-8111-111111111111";
const orgId = "22222222-2222-4222-8222-222222222222";
const businessId = "33333333-3333-4333-8333-333333333333";
const runId = "44444444-4444-4444-8444-444444444444";
const insightId = "broad_scope_gap" as const;
const scope: V1CustomerQaScope = { userId, orgId, businessId, runId };

const allowedResponse: CustomerEvidenceReadResponse = {
  ok: true,
  scope: { orgId, businessId, runId, insightId },
  detail: {
    title: "넓은 범위 검색 확인",
    recommendedCheck: "실제 공개 정보를 비교하세요.",
    observation: "기존 측정 관찰",
    explanation: "인과관계를 보장하지 않습니다.",
    evidence: [
      { label: "기준 검색 확정", value: "0/8" },
      { label: "맞춤 검색 확정", value: "3/16" },
    ],
    disclaimer: "이번 측정 근거만 확인합니다.",
  },
};

const checks = (
  args: Partial<Parameters<typeof canRenderV1CustomerEvidenceQa>[0]> = {},
) => canRenderV1CustomerEvidenceQa({
  adminAllowed: true,
  expanded: true,
  isFetching: false,
  selected: scope,
  current: scope,
  insightId,
  response: allowedResponse,
  ...args,
});

describe("Action v1 owner summary: administrator-only customer evidence QA", () => {
  it("renders only the exact successful response in an opened, authorized QA", () => {
    expect(checks()).toBe(true);
    expect(checks({ adminAllowed: false })).toBe(false);
    expect(checks({ expanded: false })).toBe(false);
    expect(checks({ isFetching: true })).toBe(false);
    expect(checks({ response: null })).toBe(false);
    expect(checks({ response: { ok: false, error: "FORBIDDEN" } })).toBe(false);
    expect(checks({ response: { ok: false, error: "NOT_AVAILABLE" } })).toBe(false);
  });

  it("never renders another user, organization, business, or Run cached detail", () => {
    expect(checks({ current: { ...scope, userId: "another-user" } })).toBe(false);
    expect(checks({ current: { ...scope, orgId: "another-org" } })).toBe(false);
    expect(checks({ current: { ...scope, businessId: "another-business" } })).toBe(false);
    expect(checks({ current: { ...scope, runId: "another-run" } })).toBe(false);
    expect(checks({ selected: { ...scope, userId: "" } })).toBe(false);
    expect(checks({ selected: { ...scope, runId: "" } })).toBe(false);
  });

  it("rejects mismatched response scope and the wrong owner summary insight", () => {
    const success = allowedResponse as Extract<CustomerEvidenceReadResponse, {ok:true}>;
    for (const changed of [
      { ...success.scope, orgId: "another-org" },
      { ...success.scope, businessId: "another-business" },
      { ...success.scope, runId: "another-run" },
      { ...success.scope, insightId: "repeated_competitor" as const },
    ]) {
      expect(checks({ response: { ...success, scope: changed } })).toBe(false);
    }
    expect(checks({ insightId: "verified_page_zero" })).toBe(false);
  });

  it("keeps the original overview and admin preview unchanged and gates new UI twice", () => {
    const at = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
    const dashboard = at("src/routes/_authenticated/dashboard.tsx");
    const inline = at("src/components/action-opportunity-v1-admin-owner-drilldown.tsx");
    const presentation = at("src/components/action-opportunity-v1-customer-evidence-candidate.tsx");
    const existingAdmin = at("src/lib/action-opportunity-v1.dashboard-private.functions.ts");
    const server = at("src/lib/action-opportunity-v1.customer-read.functions.ts");

    expect(dashboard).toContain("에 우리 업체가 나왔어요");
    expect(dashboard).toContain("이번 측정에서 확인할");
    expect(dashboard).toContain("어떤 종류의 질문에서 내 업체가 나왔나요?");
    expect(dashboard).toContain("이번 측정에서 관찰된 다른 업체");
    expect(dashboard).toContain("getActionOpportunityV1DashboardPrivatePreview");
    expect(dashboard).toContain("setPrivateV1Focus(insight)");
    expect(dashboard).toContain("focusedInsight={privateV1Focus}");
    expect(dashboard).toContain("customerEvidenceQaScope={");
    expect(dashboard).toContain("privateV1AdminAllowed &&");
    expect(dashboard).toContain("dto.business.id === businessId");
    expect(dashboard).toContain("isCustomerEvidenceInsightId(item.id)");
    expect(dashboard).toContain("<ActionOpportunityV1AdminOwnerDrilldown");
    expect(dashboard).toContain("관리자 상세 검수 도구");
    expect(dashboard).toContain("onClick={() => onReviewEvidence(item)}");
    expect(dashboard).not.toContain("관리자 검수 · 이 항목의 근거 미리보기");
    expect(dashboard).toContain("key={`${customerEvidenceQaScope.userId}:${customerEvidenceQaScope.orgId}:${customerEvidenceQaScope.businessId}:${customerEvidenceQaScope.runId}:${item.id}`}");

    expect(inline).toContain("getActionOpportunityV1CustomerEvidence");
    expect(inline).toContain("enabled: expanded && adminAllowed");
    expect(inline).toContain("canRenderV1CustomerEvidenceQa({");
    expect(inline).toContain("scope.userId,");
    expect(inline).toContain("scope.orgId,");
    expect(inline).toContain("scope.businessId,");
    expect(inline).toContain("scope.runId,");
    expect(inline).toContain("insightId,");
    expect(inline).toContain('className="no-print"');
    expect(inline).toContain("aria-expanded={expanded}");
    expect(inline).toContain("판단 근거 자세히 보기");
    expect(inline).toContain("판단 근거 닫기");
    expect(inline).toContain("<ActionOpportunityV1CustomerEvidenceCandidate");
    expect(inline).toContain("detail={response.detail}");
    expect(inline).not.toContain("expandEvidence");
    expect(inline).toContain("if (!adminAllowed) return null");
    expect((inline.match(/<Button\b/gu) ?? [])).toHaveLength(1);
    expect(presentation).not.toContain("<details");
    expect(presentation).not.toContain("useState(");
    expect(presentation).toContain("이번 측정에서 확인된 사실");
    expect(presentation).toContain("판단 근거");
    expect(presentation).not.toContain("{detail.recommendedCheck}");
    expect(presentation).toContain("{detail.disclaimer}");

    // No customer preview release: only the existing internal admin RPC
    // and its authenticated + membership checks remain in place.
    expect(existingAdmin).toContain('rpc("can_view_data_asset_admin_v01")');
    expect(server).toContain(".middleware([requireSupabaseAuth])");
    expect(server).toContain(".from(\"organization_members\")");
    expect(server).toContain("gateway.data.scope.runId !== data.expectedRunId");
    expect(dashboard).not.toContain("getActionOpportunityV1CustomerEvidence");
    expect(dashboard).toContain("print-report");

    for (const code of [inline, dashboard.slice(0, 5000)]) {
      for (const forbidden of ["service_role", "SUPABASE_SERVICE_ROLE_KEY", "debitMeasurementCredit("]) {
        expect(code).not.toContain(forbidden);
      }
    }
  });
});
