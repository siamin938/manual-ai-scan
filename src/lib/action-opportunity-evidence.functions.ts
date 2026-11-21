import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  fetchActionOpportunityEvidence,
  type ActionOpportunityEvidenceExample,
  type CurrentRunSourceReference,
} from "@/lib/action-opportunity-evidence.server";

export type { ActionOpportunityEvidenceExample, CurrentRunSourceReference };

export type ActionOpportunityEvidenceResponse =
  | {
      ok: true;
      highVisibilityExamples: ActionOpportunityEvidenceExample[];
      currentRunReferences: CurrentRunSourceReference[];
      peerPageReferences: CurrentRunSourceReference[];
    }
  | { ok: false; error: "FORBIDDEN" | "INTERNAL_ERROR" };

export const getActionOpportunityEvidence = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: {
    orgId: string;
    businessId: string;
    highVisibilityThresholdPct: number;
    expectedRunId?: string;
  }) => {
    if (
      !input?.orgId ||
      !input?.businessId ||
      typeof input.highVisibilityThresholdPct !== "number" ||
      !Number.isFinite(input.highVisibilityThresholdPct)
    ) {
      throw new Error("INVALID_REQUEST");
    }
    return {
      orgId: input.orgId,
      businessId: input.businessId,
      ...(typeof input.expectedRunId === "string" ? { expectedRunId: input.expectedRunId } : {}),
      highVisibilityThresholdPct: Math.max(
        0,
        Math.min(100, input.highVisibilityThresholdPct),
      ),
    };
  })
  .handler(async ({ data, context }): Promise<ActionOpportunityEvidenceResponse> => {
    const { data: membership, error } = await context.supabase
      .from("organization_members")
      .select("org_id")
      .eq("org_id", data.orgId)
      .eq("user_id", context.userId)
      .maybeSingle();

    if (error) return { ok: false, error: "INTERNAL_ERROR" };
    if (!membership) return { ok: false, error: "FORBIDDEN" };

    try {
      const result = await fetchActionOpportunityEvidence({ ...data, includeAnswerEvidence: !!data.expectedRunId });
      return {
        ok: true,
        highVisibilityExamples: result.highVisibilityExamples,
        currentRunReferences: result.currentRunReferences,
        peerPageReferences: result.peerPageReferences,
      };
    } catch {
      // Optional evidence must never break the main dashboard.
      return {
        ok: true,
        highVisibilityExamples: [],
        currentRunReferences: [],
        peerPageReferences: [],
      };
    }
  });
