// RECONSTRUCTED_COMPILE_ONLY
// The deployed Supabase runtime bundle omits this type-only module because it has
// no runtime effect. These declarations were reconstructed only from the exact
// deployed runtime imports/usages. Do not treat this file as a byte-for-byte copy
// of the lost original source.

export type ProviderName = "openai" | "gemini" | "perplexity";
export type SearchContextSize = "low" | "medium" | "high";

export interface ApprovedProviderRequest {
  query: string;
  language: string;
  country?: string;
  region?: string;
  city?: string;
  searchContextSize: SearchContextSize;
  modelName: string;
  estimatedCostUsd: number;
}

export interface ProviderSettingRow {
  org_id: string;
  provider: ProviderName;
  enabled: boolean;
  model_name: string;
  search_context_size: string;
  estimated_cost_per_request_usd: number | string;
  paid_account_confirmed: boolean;
  terms_reviewed: boolean;
  terms_version?: string | null;
  terms_reviewed_at?: string | null;
  terms_reviewed_by?: string | null;
  automated_benchmark_approved: boolean;
  approval_reference?: string | null;
  config?: Record<string, unknown> | null;
}
