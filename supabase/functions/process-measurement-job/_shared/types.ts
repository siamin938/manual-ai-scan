// RECONSTRUCTED_COMPILE_ONLY
// The deployed Supabase runtime bundle omits this type-only module because it has
// no runtime effect. These declarations were reconstructed only from the exact
// deployed runtime imports/usages recovered on 2026-09-13. Do not treat this
// file as a byte-for-byte copy of the lost original source.

export type ProviderName = "openai" | "gemini" | "perplexity";
export type SearchContextSize = "low" | "medium" | "high";
export type ParseConfidence = "low" | "medium" | "high";

export interface ProviderSource {
  url: string;
  domain?: string;
  title?: string;
}

export interface BusinessForParsing {
  id: string;
  name: string;
  aliases: string[];
  officialDomains: string[];
  isClient: boolean;
}

export interface ParsedMention {
  businessId?: string;
  displayName: string;
  matchedAlias?: string;
  position: number;
  explicitRank: boolean;
  confidence: ParseConfidence;
}

export interface ParsedMeasurement {
  valid: boolean;
  invalidReason?: string;
  wasClientMentioned: boolean;
  clientPosition?: number;
  clientDomainCited: boolean;
  parseConfidence: ParseConfidence;
  manualReviewRequired: boolean;
  mentions: ParsedMention[];
}

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

export interface ProviderUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  actualCostUsd?: number;
}

export interface ProviderResult {
  provider: ProviderName;
  model: string;
  text: string;
  sources: ProviderSource[];
  requestId?: string;
  usage: ProviderUsage;
  actualCostUsd: number;
  requestPayloadRedacted: Record<string, unknown>;
  rawPayload: Record<string, unknown>;
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

export interface ClaimedJob {
  id: string;
  org_id: string;
  run_id: string;
  question_id: string;
  provider: ProviderName;
  provider_model: string;
  repetition_no: number;
  attempt_count: number;
  estimated_cost_usd: number | string;
}
