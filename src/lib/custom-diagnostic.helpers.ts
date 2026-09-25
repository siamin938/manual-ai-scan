// Client-safe types and pure helpers for the custom (맞춤) diagnostic DTO.

/**
 * v0.1 convention: custom question sets are identified by this exact name
 * prefix (set by the questions screen when saving custom questions).
 * question_sets has no kind column yet, so this prefix plus the run filters
 * keeps custom runs separate from the standard 24-question diagnostic.
 */
export const CUSTOM_QUESTION_SET_NAME_PREFIX = "맞춤 질문 · ";

export type CustomDiagnosticQuestionStatus = "confirmed" | "unresolved" | "missing" | "invalid";

export type CustomDiagnosticQuestionDTO = {
  questionId: string;
  promptText: string;
  intentType: string;
  status: CustomDiagnosticQuestionStatus;
  position: number | null;
};

export type CustomDiagnosticDTO = {
  runId: string;
  questionSetId: string;
  questionSetName: string;
  measuredAt: string;
  totalJobs: number;
  completedJobs: number;
  failedJobs: number;
  validCount: number;
  invalidCount: number;
  confirmedCount: number;
  unresolvedCount: number;
  missingCount: number;
  confirmedPct: number | null;
  questions: CustomDiagnosticQuestionDTO[];
};

export type CustomDiagnosticResponse =
  | { ok: true; data: CustomDiagnosticDTO | null }
  | { ok: false; error: "FORBIDDEN" | "BUSINESS_NOT_AVAILABLE" | "INTERNAL_ERROR" };

export function classifyCustomMeasurement(m: {
  valid: boolean | null | undefined;
  was_client_mentioned: boolean | null | undefined;
  client_position: number | null | undefined;
}): CustomDiagnosticQuestionStatus {
  if (m.valid !== true) return "invalid";
  if (typeof m.client_position === "number") return "confirmed";
  if (m.was_client_mentioned === true) return "unresolved";
  return "missing";
}

export function summarizeCustomQuestions(questions: CustomDiagnosticQuestionDTO[]) {
  const count = (s: CustomDiagnosticQuestionStatus) =>
    questions.filter((q) => q.status === s).length;
  const confirmedCount = count("confirmed");
  const unresolvedCount = count("unresolved");
  const missingCount = count("missing");
  const invalidCount = count("invalid");
  const validCount = confirmedCount + unresolvedCount + missingCount;
  return {
    validCount,
    invalidCount,
    confirmedCount,
    unresolvedCount,
    missingCount,
    confirmedPct: validCount > 0 ? (confirmedCount / validCount) * 100 : null,
  };
}
