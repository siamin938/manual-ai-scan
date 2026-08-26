/**
 * Entity Verification wrapper (server-only).
 *
 * CORE ENGINE ISOLATION
 * - 판정 규칙과 persistence는 Supabase Edge Function `entity-verification`이 전담한다.
 * - 이 wrapper는 현재 사용자 JWT로 최소 식별자만 보내고 최소 요약 DTO만 돌려준다.
 * - service_role / secret / API key를 사용하거나 노출하지 않는다.
 * - Provider / OpenAI / 측정 실행은 하지 않는다.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { ENTITY_VERIFIER_VERSION, type EntityVerificationSummary } from "./entity-verification";

export { ENTITY_VERIFIER_VERSION };
export type { EntityVerificationSummary };

const VERIFICATION_FUNCTION = "entity-verification";

type UserClient = SupabaseClient<Database>;

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function asSummary(value: unknown): EntityVerificationSummary | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const s = value as Record<string, unknown>;
  const version = s["verifierVersion"] ?? s["verifier_version"];
  if (typeof version !== "string" || version.length === 0) return null;
  return {
    verifierVersion: version,
    mentionCount: num(s["mentionCount"] ?? s["mention_count"]),
    insertedCount: num(s["insertedCount"] ?? s["inserted_count"]),
    skippedCount: num(s["skippedCount"] ?? s["skipped_count"]),
    confirmedBusinessCount: num(s["confirmedBusinessCount"] ?? s["confirmed_business_count"]),
    rejectedCount: num(s["rejectedCount"] ?? s["rejected_count"]),
    needsReviewCount: num(s["needsReviewCount"] ?? s["needs_review_count"]),
  };
}

export async function verifyAndPersistBusinessEntities(args: {
  supabase: UserClient;
  orgId: string;
  businessId: string;
  runId?: string;
}): Promise<EntityVerificationSummary> {
  const { supabase, orgId, businessId, runId } = args;
  if (!orgId || !businessId) throw new Error("ORG_AND_BUSINESS_REQUIRED");

  const { data, error } = await supabase.functions.invoke(VERIFICATION_FUNCTION, {
    body: runId ? { orgId, businessId, runId } : { orgId, businessId },
  });
  if (error) throw new Error("ENTITY_VERIFICATION_FAILED");

  const payload = (data ?? null) as Record<string, unknown> | null;
  if (!payload || typeof payload !== "object" || payload["ok"] !== true) {
    throw new Error("ENTITY_VERIFICATION_FAILED");
  }
  const summary = asSummary(payload["summary"]);
  if (!summary) throw new Error("ENTITY_VERIFICATION_FAILED");
  return summary;
}
