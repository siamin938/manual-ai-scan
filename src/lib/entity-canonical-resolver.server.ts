/**
 * Canonical Entity Resolver wrapper (server-only).
 *
 * CORE ENGINE ISOLATION
 * - 병합 규칙 / 이름·URL 정규화 / reason code / persistence는 Supabase Edge Function
 *   `entity-canonical-resolver`가 전담한다.
 * - 이 wrapper는 현재 사용자 JWT로 최소 식별자만 보내고 최소 요약 DTO만 돌려준다.
 * - service_role / secret / API key를 사용하거나 노출하지 않는다.
 * - Provider / OpenAI / 측정 실행은 하지 않는다.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { RESOLVER_VERSION, type CanonicalResolutionSummary } from "./entity-canonical-resolver";

export { RESOLVER_VERSION };
export type { CanonicalResolutionSummary };

const RESOLVER_FUNCTION = "entity-canonical-resolver";

type UserClient = SupabaseClient<Database>;

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function asSummary(value: unknown): CanonicalResolutionSummary | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const s = value as Record<string, unknown>;
  const version = s["resolverVersion"] ?? s["resolver_version"];
  if (typeof version !== "string" || version.length === 0) return null;
  return {
    resolverVersion: version,
    candidateCount: num(s["candidateCount"] ?? s["candidate_count"]),
    insertedCount: num(s["insertedCount"] ?? s["inserted_count"]),
    skippedCount: num(s["skippedCount"] ?? s["skipped_count"]),
    matchedBusinessCount: num(s["matchedBusinessCount"] ?? s["matched_business_count"]),
    mergedCount: num(s["mergedCount"] ?? s["merged_count"]),
    standaloneCount: num(s["standaloneCount"] ?? s["standalone_count"]),
  };
}

export async function resolveAndPersistRunCanonicalEntities(args: {
  supabase: UserClient;
  orgId: string;
  businessId: string;
  runId: string;
}): Promise<CanonicalResolutionSummary> {
  const { supabase, orgId, businessId, runId } = args;
  if (!orgId || !businessId || !runId) throw new Error("ORG_BUSINESS_AND_RUN_REQUIRED");

  const { data, error } = await supabase.functions.invoke(RESOLVER_FUNCTION, {
    body: { orgId, businessId, runId },
  });
  if (error) throw new Error("ENTITY_CANONICALIZATION_FAILED");

  const payload = (data ?? null) as Record<string, unknown> | null;
  if (!payload || typeof payload !== "object" || payload["ok"] !== true) {
    throw new Error("ENTITY_CANONICALIZATION_FAILED");
  }
  const summary = asSummary(payload["summary"]);
  if (!summary) throw new Error("ENTITY_CANONICALIZATION_FAILED");
  return summary;
}
