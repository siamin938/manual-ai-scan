// Core Engine Isolation: 이 파일은 Supabase Edge Function `visibility-diagnostic`
// 호출 wrapper이다. 대표 run 선택, 경쟁업체 판정, 출처 집계, 우선순위 산식 등
// 계산 규칙은 이 저장소에 없다. 요청은 현재 사용자 JWT로 전송되며
// `{ orgId, businessId }` 최소 식별자만 보낸다. 응답은 계약 형태만 엄격 검증하고
// 숫자는 받은 값을 그대로 사용한다(변환/추정 금지).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type {
  VisibilityBusinessDTO,
  VisibilityCompetitorDTO,
  VisibilityCompetitorGateDTO,
  VisibilityDataQualityDTO,
  VisibilityDiagnosticBodyDTO,
  VisibilityDiagnosticDTO,
  VisibilityDiagnosticErrorCode,
  VisibilityDiagnosticResponseDTO,
  VisibilityOverviewDTO,
  VisibilityPriorityAreaDTO,
  VisibilityQuestionGroupDTO,
  VisibilityScopeDTO,
  VisibilitySourceDTO,
  VisibilityTrendPointDTO,
} from "./visibility-diagnostic.types";

type UserClient = SupabaseClient<Database>;

const DIAGNOSTIC_FUNCTION = "visibility-diagnostic";

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

/** number | null 계약: null 허용, 그 외 숫자만. undefined/문자열은 계약 위반. */
function nullableNum(value: unknown): { ok: true; value: number | null } | { ok: false } {
  if (value === null) return { ok: true, value: null };
  const n = num(value);
  return n === null ? { ok: false } : { ok: true, value: n };
}

/** string | null 계약: null 허용, 그 외 문자열만. */
function nullableStr(value: unknown): { ok: true; value: string | null } | { ok: false } {
  if (value === null) return { ok: true, value: null };
  const v = str(value);
  return v === null ? { ok: false } : { ok: true, value: v };
}

function bool(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

/** 배열 요소 중 하나라도 계약 위반이면 전체를 실패로 본다(fail-closed). */
function strictArray<T>(value: unknown, parse: (item: Obj) => T | null): T[] | null {
  if (!Array.isArray(value)) return null;
  const out: T[] = [];
  for (const item of value) {
    if (!isObj(item)) return null;
    const parsed = parse(item);
    if (parsed === null) return null;
    out.push(parsed);
  }
  return out;
}

function parseBusiness(value: unknown): VisibilityBusinessDTO | null {
  if (!isObj(value)) return null;
  const id = str(value["id"]);
  const name = str(value["name"]);
  if (id === null || name === null) return null;
  const category = nullableStr(value["category"]);
  const region = nullableStr(value["region"]);
  const city = nullableStr(value["city"]);
  if (!category.ok || !region.ok || !city.ok) return null;
  return { id, name, category: category.value, region: region.value, city: city.value };
}

function parseScope(value: unknown): VisibilityScopeDTO | null {
  if (!isObj(value)) return null;
  const runId = str(value["runId"]);
  const runName = str(value["runName"]);
  const measuredAt = str(value["measuredAt"]);
  const providers = Array.isArray(value["providers"])
    ? value["providers"].every((p) => typeof p === "string")
      ? (value["providers"] as string[])
      : null
    : null;
  const repetitions = num(value["repetitions"]);
  const totalJobs = num(value["totalJobs"]);
  const completedJobs = num(value["completedJobs"]);
  const failedJobs = num(value["failedJobs"]);
  if (
    runId === null ||
    runName === null ||
    measuredAt === null ||
    providers === null ||
    repetitions === null ||
    totalJobs === null ||
    completedJobs === null ||
    failedJobs === null ||
    value["runType"] !== "audit" ||
    value["phase"] !== "standalone" ||
    value["experimentRunsExcluded"] !== true
  ) {
    return null;
  }
  return {
    runId,
    runName,
    measuredAt,
    runType: "audit",
    phase: "standalone",
    providers,
    repetitions,
    totalJobs,
    completedJobs,
    failedJobs,
    experimentRunsExcluded: true,
  };
}

function parseOverview(value: unknown): VisibilityOverviewDTO | null {
  if (!isObj(value)) return null;
  const validCount = num(value["validCount"]);
  const invalidCount = num(value["invalidCount"]);
  const mentionCount = num(value["mentionCount"]);
  const top3Count = num(value["top3Count"]);
  const questionCount = num(value["questionCount"]);
  const coveredQuestionCount = num(value["coveredQuestionCount"]);
  const visibilityRatePct = nullableNum(value["visibilityRatePct"]);
  const top3RatePct = nullableNum(value["top3RatePct"]);
  const questionCoverageRatePct = nullableNum(value["questionCoverageRatePct"]);
  if (
    validCount === null ||
    invalidCount === null ||
    mentionCount === null ||
    top3Count === null ||
    questionCount === null ||
    coveredQuestionCount === null ||
    !visibilityRatePct.ok ||
    !top3RatePct.ok ||
    !questionCoverageRatePct.ok
  ) {
    return null;
  }
  return {
    validCount,
    invalidCount,
    mentionCount,
    visibilityRatePct: visibilityRatePct.value,
    top3Count,
    top3RatePct: top3RatePct.value,
    questionCount,
    coveredQuestionCount,
    questionCoverageRatePct: questionCoverageRatePct.value,
  };
}

function parseQuestionGroup(o: Obj): VisibilityQuestionGroupDTO | null {
  const intentType = str(o["intentType"]);
  const questionCount = num(o["questionCount"]);
  const measurementCount = num(o["measurementCount"]);
  const mentionCount = num(o["mentionCount"]);
  const visibilityRatePct = nullableNum(o["visibilityRatePct"]);
  const top3RatePct = nullableNum(o["top3RatePct"]);
  if (
    intentType === null ||
    questionCount === null ||
    measurementCount === null ||
    mentionCount === null ||
    !visibilityRatePct.ok ||
    !top3RatePct.ok
  ) {
    return null;
  }
  return {
    intentType,
    questionCount,
    measurementCount,
    mentionCount,
    visibilityRatePct: visibilityRatePct.value,
    top3RatePct: top3RatePct.value,
  };
}

function parseCompetitor(o: Obj): VisibilityCompetitorDTO | null {
  const name = str(o["name"]);
  const mentionCount = num(o["mentionCount"]);
  const responseCount = num(o["responseCount"]);
  const responseRatePct = nullableNum(o["responseRatePct"]);
  const tier = o["tier"];
  const tierLabel = str(o["tierLabel"]);
  const questionCount = num(o["questionCount"]);
  const top3ResponseCount = num(o["top3ResponseCount"]);
  const priorRunPresenceCount = num(o["priorRunPresenceCount"]);
  const isNew = bool(o["isNew"]);
  if (
    name === null ||
    mentionCount === null ||
    responseCount === null ||
    !responseRatePct.ok ||
    (tier !== "core" && tier !== "notable") ||
    tierLabel === null ||
    questionCount === null ||
    top3ResponseCount === null ||
    priorRunPresenceCount === null ||
    isNew === null
  ) {
    return null;
  }
  return {
    name,
    mentionCount,
    responseCount,
    responseRatePct: responseRatePct.value,
    tier,
    tierLabel,
    questionCount,
    top3ResponseCount,
    priorRunPresenceCount,
    isNew,
  };
}

function parseCompetitorGate(value: unknown): VisibilityCompetitorGateDTO | null {
  if (!isObj(value) || value["version"] !== "0.1") return null;
  const coreCount = num(value["coreCount"]);
  const notableCount = num(value["notableCount"]);
  const watchCount = num(value["watchCount"]);
  if (coreCount === null || notableCount === null || watchCount === null) return null;
  return { version: "0.1", coreCount, notableCount, watchCount };
}

function parseSource(o: Obj): VisibilitySourceDTO | null {
  const domain = str(o["domain"]);
  const citationCount = num(o["citationCount"]);
  const responseCount = num(o["responseCount"]);
  const responseRatePct = nullableNum(o["responseRatePct"]);
  if (domain === null || citationCount === null || responseCount === null || !responseRatePct.ok) {
    return null;
  }
  const sampleTitle = nullableStr(o["sampleTitle"]);
  if (!sampleTitle.ok) return null;
  return {
    domain,
    citationCount,
    responseCount,
    responseRatePct: responseRatePct.value,
    sampleTitle: sampleTitle.value,
  };
}

function parsePriorityArea(o: Obj): VisibilityPriorityAreaDTO | null {
  const questionId = str(o["questionId"]);
  const questionText = str(o["questionText"]);
  const intentType = str(o["intentType"]);
  const status = o["status"];
  const measurementCount = num(o["measurementCount"]);
  const mentionCount = num(o["mentionCount"]);
  const visibilityRatePct = nullableNum(o["visibilityRatePct"]);
  if (
    questionId === null ||
    questionText === null ||
    intentType === null ||
    (status !== "missing" && status !== "partial") ||
    measurementCount === null ||
    mentionCount === null ||
    !visibilityRatePct.ok
  ) {
    return null;
  }
  return {
    questionId,
    questionText,
    intentType,
    status,
    measurementCount,
    mentionCount,
    visibilityRatePct: visibilityRatePct.value,
  };
}

function parseDataQuality(value: unknown): VisibilityDataQualityDTO | null {
  if (!isObj(value)) return null;
  const measurementRowsCapped = bool(value["measurementRowsCapped"]);
  const sourceRowsCapped = bool(value["sourceRowsCapped"]);
  if (measurementRowsCapped === null || sourceRowsCapped === null) return null;
  return { measurementRowsCapped, sourceRowsCapped };
}

function parseDiagnosticBody(value: unknown): VisibilityDiagnosticBodyDTO | null {
  if (!isObj(value)) return null;
  const scope = parseScope(value["scope"]);
  const overview = parseOverview(value["overview"]);
  const questionGroups = strictArray(value["questionGroups"], parseQuestionGroup);
  const competitors = strictArray(value["competitors"], parseCompetitor);
  const competitorGate = parseCompetitorGate(value["competitorGate"]);
  const sources = strictArray(value["sources"], parseSource);
  const priorityAreas = strictArray(value["priorityAreas"], parsePriorityArea);
  const dataQuality = parseDataQuality(value["dataQuality"]);
  if (
    scope === null ||
    overview === null ||
    questionGroups === null ||
    competitors === null ||
    competitorGate === null ||
    sources === null ||
    priorityAreas === null ||
    dataQuality === null
  ) {
    return null;
  }
  return {
    scope,
    overview,
    questionGroups,
    competitors,
    competitorGate,
    sources,
    priorityAreas,
    dataQuality,
  };
}

function parseTrendPoint(o: Obj): VisibilityTrendPointDTO | null {
  const measuredAt = str(o["measuredAt"]);
  const validCount = num(o["validCount"]);
  const mentionCount = num(o["mentionCount"]);
  const visibilityRatePct = nullableNum(o["visibilityRatePct"]);
  const top3RatePct = nullableNum(o["top3RatePct"]);
  if (
    measuredAt === null ||
    validCount === null ||
    mentionCount === null ||
    !visibilityRatePct.ok ||
    !top3RatePct.ok
  ) {
    return null;
  }
  return {
    measuredAt,
    validCount,
    mentionCount,
    visibilityRatePct: visibilityRatePct.value,
    top3RatePct: top3RatePct.value,
  };
}

function asErrorCode(value: unknown): VisibilityDiagnosticErrorCode {
  return value === "FORBIDDEN" ? "FORBIDDEN" : "INTERNAL_ERROR";
}

/**
 * 계약 검증 결과. `diagnostic: null`은 진단 데이터 없음(NO_DATA)으로 매핑한다.
 * 계약과 조금이라도 다르면 값을 보정하지 않고 INVALID_DTO로 닫는다.
 */
export function parseVisibilityDiagnosticResponse(
  payload: unknown,
): VisibilityDiagnosticResponseDTO {
  if (!isObj(payload) || payload["ok"] !== true) return { ok: false, error: "INVALID_DTO" };

  const generatedAt = str(payload["generatedAt"]);
  const business = parseBusiness(payload["business"]);
  const trend = strictArray(payload["trend"], parseTrendPoint);
  if (generatedAt === null || business === null || trend === null) {
    return { ok: false, error: "INVALID_DTO" };
  }

  if (payload["diagnostic"] === null) return { ok: false, error: "NO_DATA", business };

  const diagnostic = parseDiagnosticBody(payload["diagnostic"]);
  if (diagnostic === null) return { ok: false, error: "INVALID_DTO" };

  return { ok: true, diagnostic: { generatedAt, business, diagnostic, trend } };
}

export type VisibilityDiagnosticResult = VisibilityDiagnosticResponseDTO;

export async function fetchVisibilityDiagnostic(args: {
  supabase: UserClient;
  orgId: string;
  businessId: string;
}): Promise<VisibilityDiagnosticResult> {
  const { data, error } = await args.supabase.functions.invoke(DIAGNOSTIC_FUNCTION, {
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
      console.error(`[visibility-diagnostic] ${DIAGNOSTIC_FUNCTION} invoke failed`);
      return { ok: false, error: "INTERNAL_ERROR" };
    }
  } else {
    payload = isObj(data) ? data : null;
  }

  if (!payload) return { ok: false, error: "INTERNAL_ERROR" };
  if (payload["ok"] !== true) return { ok: false, error: asErrorCode(payload["error"]) };

  return parseVisibilityDiagnosticResponse(payload);
}

export type { VisibilityDiagnosticDTO };
