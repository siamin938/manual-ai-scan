import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { CUSTOMER_STANDARD_QUESTION_COUNT, isUuid } from "./customer-measurement.helpers";

export type QuestionAnswerScope = { orgId: string; businessId: string; runId: string };
type QuestionAnswerRequest = QuestionAnswerScope & { questionId: string };

export const getDiagnosticQuestionAnswers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: QuestionAnswerRequest) => {
    if (!input || ![input.orgId, input.businessId, input.runId, input.questionId].every(isUuid)) {
      throw new Error("INVALID_REQUEST");
    }
    return input;
  })
  .handler(async ({ data, context }) => {
    // Both queries run with the signed-in member's RLS and the exact displayed scope.
    const { orgId, businessId, runId, questionId } = data;
    const run = await context.supabase.from("measurement_runs")
      .select("id,businesses!inner(id)")
      .eq("id", runId).eq("org_id", orgId).eq("business_id", businessId)
      .eq("businesses.org_id", orgId).eq("businesses.active", true).eq("businesses.is_client_business", true)
      .eq("run_type", "audit").eq("phase", "standalone").is("experiment_id", null)
      .eq("diagnostic_scope", "customer").eq("status", "completed")
      .eq("total_jobs", CUSTOMER_STANDARD_QUESTION_COUNT).maybeSingle();
    if (run.error || !run.data) throw new Error("QUESTION_SCOPE_UNAVAILABLE");

    const answers = await context.supabase.from("measurements")
      .select("id,provider,response_text,valid")
      .eq("org_id", orgId).eq("run_id", runId).eq("question_id", questionId)
      .order("observed_at", { ascending: true }).order("id", { ascending: true });
    if (answers.error) throw new Error("QUESTION_ANSWERS_UNAVAILABLE");
    return answers.data.map(row => ({
      id: row.id, provider: row.provider, text: row.response_text, valid: row.valid,
    }));
  });
