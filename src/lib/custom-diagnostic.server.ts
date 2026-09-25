import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  CUSTOM_QUESTION_SET_NAME_PREFIX,
  classifyCustomMeasurement,
  summarizeCustomQuestions,
  type CustomDiagnosticQuestionDTO,
  type CustomDiagnosticResponse,
} from "./custom-diagnostic.helpers";

const STATUS_ORDER = { confirmed: 0, unresolved: 1, missing: 2, invalid: 3 } as const;

export async function fetchCustomDiagnostic(args: {
  orgId: string;
  businessId: string;
}): Promise<CustomDiagnosticResponse> {
  const { orgId, businessId } = args;

  const { data: business, error: bErr } = await supabaseAdmin
    .from("businesses")
    .select("id")
    .eq("id", businessId)
    .eq("org_id", orgId)
    .eq("is_client_business", true)
    .eq("active", true)
    .maybeSingle();
  if (bErr) return { ok: false, error: "INTERNAL_ERROR" };
  if (!business) return { ok: false, error: "BUSINESS_NOT_AVAILABLE" };

  // v0.1 convention: custom sets are identified by exact name prefix.
  const { data: sets, error: sErr } = await supabaseAdmin
    .from("question_sets")
    .select("id, name")
    .eq("org_id", orgId)
    .eq("business_id", businessId)
    .eq("active", true);
  if (sErr) return { ok: false, error: "INTERNAL_ERROR" };
  const customSets = (sets ?? []).filter((s) =>
    s.name?.startsWith(CUSTOM_QUESTION_SET_NAME_PREFIX),
  );
  if (customSets.length === 0) return { ok: true, data: null };

  const { data: run, error: rErr } = await supabaseAdmin
    .from("measurement_runs")
    .select(
      "id, question_set_id, completed_at, created_at, total_jobs, completed_jobs, failed_jobs",
    )
    .eq("org_id", orgId)
    .eq("business_id", businessId)
    .eq("run_type", "audit")
    .eq("phase", "standalone")
    .eq("diagnostic_scope", "customer")
    .eq("status", "completed")
    .is("experiment_id", null)
    .in(
      "question_set_id",
      customSets.map((s) => s.id),
    )
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (rErr) return { ok: false, error: "INTERNAL_ERROR" };
  if (!run || !run.question_set_id) return { ok: true, data: null };

  const { data: measurements, error: mErr } = await supabaseAdmin
    .from("measurements")
    .select("id, question_id, valid, was_client_mentioned, client_position")
    .eq("org_id", orgId)
    .eq("run_id", run.id);
  if (mErr) return { ok: false, error: "INTERNAL_ERROR" };

  const questionIds = [...new Set((measurements ?? []).map((m) => m.question_id))];
  const questionById = new Map<string, { prompt_text: string; intent_type: string }>();
  if (questionIds.length > 0) {
    const { data: qs, error: qErr } = await supabaseAdmin
      .from("questions")
      .select("id, prompt_text, intent_type")
      .in("id", questionIds);
    if (qErr) return { ok: false, error: "INTERNAL_ERROR" };
    for (const q of qs ?? []) questionById.set(q.id, q);
  }

  const questions: CustomDiagnosticQuestionDTO[] = (measurements ?? [])
    .map((m) => {
      const status = classifyCustomMeasurement(m);
      const q = questionById.get(m.question_id);
      return {
        questionId: m.question_id,
        promptText: q?.prompt_text ?? "",
        intentType: q?.intent_type ?? "",
        status,
        position: status === "confirmed" ? m.client_position : null,
      };
    })
    .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);

  const set = customSets.find((s) => s.id === run.question_set_id)!;
  return {
    ok: true,
    data: {
      runId: run.id,
      questionSetId: run.question_set_id,
      questionSetName: set.name,
      measuredAt: run.completed_at ?? run.created_at,
      totalJobs: run.total_jobs,
      completedJobs: run.completed_jobs,
      failedJobs: run.failed_jobs,
      ...summarizeCustomQuestions(questions),
      questions,
    },
  };
}
