// Core Engine Isolation: 이 파일은 Supabase Edge Function
// `visibility-action-recommendations` 호출 wrapper이다. 추천 생성/순위/근거 수준
// 판정 규칙은 이 저장소에 없다. 요청은 현재 사용자 JWT로 `{ orgId, businessId }`
// 최소 식별자만 보내고, 응답은 계약 형태만 엄격히 검증한다(fail-closed).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type {
  ActionChannelActionType,
  ActionChannelSuggestionDTO,
  ActionRecommendationDTO,
  ActionRecommendationEvidenceDTO,
  ActionRecommendationsErrorCode,
  ActionRecommendationsResponseDTO,
  ActionScopeDTO,
  ActionSourceGroupDTO,
  ActionSourcePlatformDTO,
} from "./visibility-actions.types";

type UserClient = SupabaseClient<Database>;

const ACTIONS_FUNCTION = "visibility-action-recommendations";

type Obj = Record<string, unknown>;

function isObj(value: unknown): value is Obj {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function str(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function strArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.every((v) => typeof v === "string") ? (value as string[]) : null;
}

function parseEvidence(value: unknown): ActionRecommendationEvidenceDTO | null {
  if (!isObj(value)) return null;
  const clientResponseCount = num(value["clientResponseCount"]);
  const competitorResponseCount = num(value["competitorResponseCount"]);
  const distinctCompetitorCount = num(value["distinctCompetitorCount"]);
  const measurementCount = num(value["measurementCount"]);
  const questionCount = num(value["questionCount"]);
  const domains = strArray(value["domains"]);
  if (
    clientResponseCount === null ||
    competitorResponseCount === null ||
    distinctCompetitorCount === null ||
    measurementCount === null ||
    questionCount === null ||
    domains === null
  ) {
    return null;
  }
  return {
    clientResponseCount,
    competitorResponseCount,
    distinctCompetitorCount,
    measurementCount,
    questionCount,
    domains,
  };
}

const CHANNEL_ACTION_TYPES = [
  "publish_candidate",
  "profile_check",
  "platform_check",
  "community_check",
  "conditional_pr",
  "observe_only",
] as const;

function parseChannelSuggestion(value: unknown): ActionChannelSuggestionDTO | null {
  if (!isObj(value)) return null;
  const key = str(value["key"]);
  const name = str(value["name"]);
  const actionTypeRaw = value["actionType"];
  const actionLabel = str(value["actionLabel"]);
  const reason = str(value["reason"]);
  const responseCount = num(value["responseCount"]);
  const relatedResponseTotal = num(value["relatedResponseTotal"]);
  const citationCount = num(value["citationCount"]);
  const distinctCompetitorCount = num(value["distinctCompetitorCount"]);
  const domains = strArray(value["domains"]);
  const isActionType = (CHANNEL_ACTION_TYPES as readonly string[]).includes(
    actionTypeRaw as string,
  );
  if (
    key === null ||
    name === null ||
    !isActionType ||
    actionLabel === null ||
    reason === null ||
    responseCount === null ||
    relatedResponseTotal === null ||
    citationCount === null ||
    distinctCompetitorCount === null ||
    domains === null
  ) {
    return null;
  }
  return {
    key,
    name,
    actionType: actionTypeRaw as ActionChannelSuggestionDTO["actionType"],
    actionLabel,
    reason,
    responseCount,
    relatedResponseTotal,
    citationCount,
    distinctCompetitorCount,
    domains,
  };
}

const SOURCE_EVIDENCE_GRADES = ["priority", "candidate", "reference"] as const;

type Opt<T> = { ok: true; value: T | undefined } | { ok: false };

function optStr(value: unknown): Opt<string> {
  if (value === undefined || value === null) return { ok: true, value: undefined };
  return typeof value === "string" ? { ok: true, value } : { ok: false };
}

function optNum(value: unknown): Opt<number> {
  if (value === undefined || value === null) return { ok: true, value: undefined };
  return typeof value === "number" && Number.isFinite(value) ? { ok: true, value } : { ok: false };
}

function optEvidenceGrade(value: unknown): Opt<ActionSourceEvidenceGrade> {
  if (value === undefined || value === null) return { ok: true, value: undefined };
  return (SOURCE_EVIDENCE_GRADES as readonly string[]).includes(value as string)
    ? { ok: true, value: value as ActionSourceEvidenceGrade }
    : { ok: false };
}

/** 서버가 준 optional 근거 필드만 계약대로 통과시킨다(값이 있으면 엄격 검증). */
function parseSourceOptionals(value: Obj):
  | {
      evidenceGrade?: ActionSourceEvidenceGrade;
      evidenceLabel?: string;
      scopeLabel?: string;
      clientOverallResponseCount?: number;
    }
  | null {
  const evidenceGrade = optEvidenceGrade(value["evidenceGrade"]);
  const evidenceLabel = optStr(value["evidenceLabel"]);
  const scopeLabel = optStr(value["scopeLabel"]);
  const clientOverallResponseCount = optNum(value["clientOverallResponseCount"]);
  if (
    !evidenceGrade.ok ||
    !evidenceLabel.ok ||
    !scopeLabel.ok ||
    !clientOverallResponseCount.ok
  ) {
    return null;
  }
  return {
    ...(evidenceGrade.value !== undefined ? { evidenceGrade: evidenceGrade.value } : {}),
    ...(evidenceLabel.value !== undefined ? { evidenceLabel: evidenceLabel.value } : {}),
    ...(scopeLabel.value !== undefined ? { scopeLabel: scopeLabel.value } : {}),
    ...(clientOverallResponseCount.value !== undefined
      ? { clientOverallResponseCount: clientOverallResponseCount.value }
      : {}),
  };
}

function parseSourcePlatform(value: unknown): ActionSourcePlatformDTO | null {
  if (!isObj(value)) return null;
  const key = str(value["key"]);
  const name = str(value["name"]);
  const actionTypeRaw = value["actionType"];
  const actionLabel = str(value["actionLabel"]);
  const responseCount = num(value["responseCount"]);
  const relatedResponseTotal = num(value["relatedResponseTotal"]);
  const citationCount = num(value["citationCount"]);
  const distinctCompetitorCount = num(value["distinctCompetitorCount"]);
  const domains = strArray(value["domains"]);
  const isActionType = (CHANNEL_ACTION_TYPES as readonly string[]).includes(
    actionTypeRaw as string,
  );
  const optionals = parseSourceOptionals(value);
  if (
    key === null ||
    name === null ||
    !isActionType ||
    actionLabel === null ||
    responseCount === null ||
    relatedResponseTotal === null ||
    citationCount === null ||
    distinctCompetitorCount === null ||
    domains === null ||
    optionals === null
  ) {
    return null;
  }
  return {
    key,
    name,
    actionType: actionTypeRaw as ActionChannelActionType,
    actionLabel,
    responseCount,
    relatedResponseTotal,
    citationCount,
    distinctCompetitorCount,
    domains,
    ...optionals,
  };
}


function parseSourceGroup(value: unknown): ActionSourceGroupDTO | null {
  if (!isObj(value)) return null;
  const key = str(value["key"]);
  const name = str(value["name"]);
  const actionTypeRaw = value["actionType"];
  const actionLabel = str(value["actionLabel"]);
  const reason = str(value["reason"]);
  const responseCount = num(value["responseCount"]);
  const relatedResponseTotal = num(value["relatedResponseTotal"]);
  const citationCount = num(value["citationCount"]);
  const distinctCompetitorCount = num(value["distinctCompetitorCount"]);
  const isActionType = (CHANNEL_ACTION_TYPES as readonly string[]).includes(
    actionTypeRaw as string,
  );
  if (
    key === null ||
    name === null ||
    !isActionType ||
    actionLabel === null ||
    reason === null ||
    responseCount === null ||
    relatedResponseTotal === null ||
    citationCount === null ||
    distinctCompetitorCount === null ||
    !Array.isArray(value["platforms"])
  ) {
    return null;
  }
  const platforms: ActionSourcePlatformDTO[] = [];
  for (const item of value["platforms"]) {
    const parsed = parseSourcePlatform(item);
    if (parsed === null) return null;
    platforms.push(parsed);
  }
  return {
    key,
    name,
    actionType: actionTypeRaw as ActionChannelActionType,
    actionLabel,
    reason,
    responseCount,
    relatedResponseTotal,
    citationCount,
    distinctCompetitorCount,
    platforms,
  };
}

function parseRecommendation(value: unknown): ActionRecommendationDTO | null {
  if (!isObj(value)) return null;
  const id = str(value["id"]);
  const rank = num(value["rank"]);
  const kind = value["kind"];
  const title = str(value["title"]);
  const evidenceLevel = value["evidenceLevel"];
  const evidenceLabel = str(value["evidenceLabel"]);
  const summary = str(value["summary"]);
  const steps = strArray(value["steps"]);
  const sampleQuestions = strArray(value["sampleQuestions"]);
  const evidence = parseEvidence(value["evidence"]);
  if (
    id === null ||
    rank === null ||
    (kind !== "source_gap" && kind !== "intent_gap") ||
    title === null ||
    (evidenceLevel !== "priority_try" &&
      evidenceLevel !== "worth_review" &&
      evidenceLevel !== "observe_more") ||
    evidenceLabel === null ||
    summary === null ||
    steps === null ||
    sampleQuestions === null ||
    evidence === null
  ) {
    return null;
  }
  if (!Array.isArray(value["channelSuggestions"])) return null;
  const channelSuggestions: ActionChannelSuggestionDTO[] = [];
  for (const item of value["channelSuggestions"]) {
    const parsed = parseChannelSuggestion(item);
    if (parsed === null) return null;
    channelSuggestions.push(parsed);
  }
  const sourceGroupsRaw = value["sourceGroups"];
  const sourceGroups: ActionSourceGroupDTO[] = [];
  if (sourceGroupsRaw !== undefined && sourceGroupsRaw !== null) {
    if (!Array.isArray(sourceGroupsRaw)) return null;
    for (const item of sourceGroupsRaw) {
      const parsed = parseSourceGroup(item);
      if (parsed === null) return null;
      sourceGroups.push(parsed);
    }
  }
  return {
    id,
    rank,
    kind,
    title,
    evidenceLevel,
    evidenceLabel,
    summary,
    steps,
    sampleQuestions,
    evidence,
    channelSuggestions,
    sourceGroups,
  };
}


function parseScope(value: unknown): { ok: true; value: ActionScopeDTO | null } | { ok: false } {
  if (value === null) return { ok: true, value: null };
  if (!isObj(value)) return { ok: false };
  const runId = str(value["runId"]);
  const runName = str(value["runName"]);
  const measuredAt = str(value["measuredAt"]);
  const repetitions = num(value["repetitions"]);
  const validCount = num(value["validCount"]);
  const competitorCount = num(value["competitorCount"]);
  if (
    runId === null ||
    runName === null ||
    measuredAt === null ||
    repetitions === null ||
    validCount === null ||
    competitorCount === null
  ) {
    return { ok: false };
  }
  return { ok: true, value: { runId, runName, measuredAt, repetitions, validCount, competitorCount } };
}

function asErrorCode(value: unknown): ActionRecommendationsErrorCode {
  return value === "FORBIDDEN" ? "FORBIDDEN" : "INTERNAL_ERROR";
}

export function parseActionRecommendationsResponse(
  payload: unknown,
): ActionRecommendationsResponseDTO {
  if (!isObj(payload) || payload["ok"] !== true) return { ok: false, error: "INVALID_DTO" };

  const generatedAt = str(payload["generatedAt"]);
  const disclaimer = str(payload["disclaimer"]);
  const businessRaw = payload["business"];
  const business = isObj(businessRaw)
    ? (() => {
        const id = str(businessRaw["id"]);
        const name = str(businessRaw["name"]);
        return id !== null && name !== null ? { id, name } : null;
      })()
    : null;
  const scope = parseScope(payload["scope"]);
  if (generatedAt === null || disclaimer === null || business === null || !scope.ok) {
    return { ok: false, error: "INVALID_DTO" };
  }

  if (!Array.isArray(payload["recommendations"])) return { ok: false, error: "INVALID_DTO" };
  const recommendations: ActionRecommendationDTO[] = [];
  for (const item of payload["recommendations"]) {
    const parsed = parseRecommendation(item);
    if (parsed === null) return { ok: false, error: "INVALID_DTO" };
    recommendations.push(parsed);
  }

  return {
    ok: true,
    data: { generatedAt, business, scope: scope.value, recommendations, disclaimer },
  };
}

export async function fetchActionRecommendations(args: {
  supabase: UserClient;
  orgId: string;
  businessId: string;
}): Promise<ActionRecommendationsResponseDTO> {
  const { data, error } = await args.supabase.functions.invoke(ACTIONS_FUNCTION, {
    body: { orgId: args.orgId, businessId: args.businessId },
  });

  let payload: Obj | null = null;
  if (error) {
    const ctx = (error as { context?: unknown }).context;
    if (ctx instanceof Response) {
      try {
        const parsed: unknown = await ctx.clone().json();
        payload = isObj(parsed) ? parsed : null;
      } catch {
        payload = null;
      }
    }
    if (!payload) {
      console.error(`[visibility-actions] ${ACTIONS_FUNCTION} invoke failed`);
      return { ok: false, error: "INTERNAL_ERROR" };
    }
  } else {
    payload = isObj(data) ? data : null;
  }

  if (!payload) return { ok: false, error: "INTERNAL_ERROR" };
  if (payload["ok"] !== true) return { ok: false, error: asErrorCode(payload["error"]) };

  return parseActionRecommendationsResponse(payload);
}
