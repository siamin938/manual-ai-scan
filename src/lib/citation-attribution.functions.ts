import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const ALLOWED_ROLES = new Set(["owner", "admin", "analyst"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type CitationAttributionResultDTO = {
  ok: boolean;
  directCount?: number;
  sectionCount?: number;
  measurementCount?: number;
  error?: string;
};

/**
 * 저장된 run 데이터만으로 citation attribution을 재계산한다.
 * Provider / OpenAI 호출 없음. 판정 규칙은 server-only 엔진에만 존재한다.
 */
export const runCitationAttribution = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { orgId: string; runId: string }) => {
    if (!UUID_RE.test(input?.orgId ?? "") || !UUID_RE.test(input?.runId ?? "")) {
      throw new Error("INVALID_INPUT");
    }
    return { orgId: input.orgId, runId: input.runId };
  })
  .handler(async ({ data, context }): Promise<CitationAttributionResultDTO> => {
    const { data: membership } = await context.supabase
      .from("organization_members")
      .select("role")
      .eq("org_id", data.orgId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!membership || !ALLOWED_ROLES.has(String(membership.role))) {
      return { ok: false, error: "FORBIDDEN" };
    }

    const { data: run } = await context.supabase
      .from("measurement_runs")
      .select("id, business_id")
      .eq("id", data.runId)
      .eq("org_id", data.orgId)
      .maybeSingle();
    if (!run?.business_id) return { ok: false, error: "RUN_NOT_FOUND" };

    try {
      const { attributeAndPersistRunCitations } = await import("./citation-attribution.server");
      const summary = await attributeAndPersistRunCitations({
        orgId: data.orgId,
        businessId: run.business_id as string,
        runId: data.runId,
      });
      return {
        ok: true,
        directCount: summary.directCount,
        sectionCount: summary.sectionCount,
        measurementCount: summary.measurementCount,
      };
    } catch {
      return { ok: false, error: "CITATION_ATTRIBUTION_FAILED" };
    }
  });
