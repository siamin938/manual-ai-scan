/**
 * `visibility-diagnostic` Edge Function DTO의 UI용 타입 정의.
 * 계산 규칙은 포함하지 않는다 (Core Engine Isolation).
 */

export type VisibilityClusterDTO = {
  label: string;
  question_count: number;
  exposure_rate_pct: number | null;
  standing: "strong" | "weak" | "mixed" | null;
};

export type VisibilityCompetitorDTO = {
  display_name: string;
  response_count: number;
  share_pct: number | null;
};

export type VisibilitySourceDTO = {
  domain: string;
  citation_count: number;
  share_pct: number | null;
  source_type: string | null;
};

export type VisibilityPriorityDTO = {
  title: string;
  detail: string | null;
  cluster_label: string | null;
  exposure_rate_pct: number | null;
};

export type VisibilityTrendPointDTO = {
  observed_at: string;
  exposure_rate_pct: number | null;
  valid_measurement_count: number | null;
};

export type VisibilitySummaryDTO = {
  valid_measurement_count: number;
  exposure_rate_pct: number | null;
  top3_rate_pct: number | null;
  exposed_question_rate_pct: number | null;
  exposed_measurement_count: number | null;
  question_count: number | null;
  exposed_question_count: number | null;
};

export type VisibilityDiagnosticDTO = {
  business_name: string | null;
  latest_observed_at: string | null;
  run_count: number | null;
  summary: VisibilitySummaryDTO;
  clusters: VisibilityClusterDTO[];
  competitors: VisibilityCompetitorDTO[];
  sources: VisibilitySourceDTO[];
  priorities: VisibilityPriorityDTO[];
  trend: VisibilityTrendPointDTO[];
};

export type VisibilityDiagnosticErrorCode =
  | "NO_DATA"
  | "FORBIDDEN"
  | "INVALID_DTO"
  | "INTERNAL_ERROR";

export type VisibilityDiagnosticResponseDTO =
  | { ok: true; diagnostic: VisibilityDiagnosticDTO }
  | { ok: false; error: VisibilityDiagnosticErrorCode };
