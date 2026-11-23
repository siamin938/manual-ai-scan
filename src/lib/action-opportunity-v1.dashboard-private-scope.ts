/**
 * Pure render gate for v1.0's authenticated administrator-only dashboard
 * preview. Cached results from an older business, org, session, or Run
 * must never render for the currently selected business.
 */
export type DashboardPrivateV1Scope = {
  orgId: string;
  businessId: string;
  runId: string;
  model: { runId: string };
};

export function canRenderDashboardPrivateV1Preview(args: {
  adminAllowed: boolean;
  selected:
    | { orgId: string; businessId: string; runId: string }
    | null;
  current: {
    orgId: string | null;
    businessId: string | null;
    runId: string | null;
  };
  preview: DashboardPrivateV1Scope | null;
}): boolean {
  const { adminAllowed, selected, current, preview } = args;
  return (
    adminAllowed &&
    selected !== null &&
    preview !== null &&
    current.orgId !== null &&
    current.businessId !== null &&
    current.runId !== null &&
    selected.orgId === current.orgId &&
    selected.businessId === current.businessId &&
    selected.runId === current.runId &&
    preview.orgId === current.orgId &&
    preview.businessId === current.businessId &&
    preview.runId === current.runId &&
    preview.model.runId === current.runId
  );
}
