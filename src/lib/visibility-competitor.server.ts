// Core Engine Isolation: 이 파일은 Supabase Edge Function
// `visibility-competitor-resolve` / `visibility-competitor-detail` 호출 wrapper이다.
// canonical 매칭, 집계, 정렬 규칙은 이 저장소에 없다. 요청은 현재 사용자 JWT로
// 전송되며 최소 식별자만 보낸다. 응답은 계약 형태만 엄격 검증하고 숫자는 그대로 쓴다.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type {
  CompetitorBusinessDTO,
  CompetitorCompareObservedIn,
  CompetitorCompareOverviewDTO,
  CompetitorCompareQuestionDTO,
  CompetitorCompareQuestionGroupDTO,
  CompetitorCompareResponseDTO,
  CompetitorCompareSourceDTO,
  CompetitorDetailDTO,
  CompetitorDetailResponseDTO,
  CompetitorErrorCode,
  CompetitorQuestionDTO,
  CompetitorQuestionGroupDTO,
  CompetitorRefDTO,
  CompetitorResolveResponseDTO,
  CompetitorScopeDTO,
  CompetitorSourceDTO,
  CompetitorSummaryDTO,
  CompetitorAttributedSourceDTO,
} from "./visibility-competitor.types";
import {
  aggregateAttributedSources,
  type AttributionAggregateRow,
} from "./citation-attribution.aggregate";

/** 고객 화면에 노출할 attribution 계약 버전 (엔진 규칙은 서버 전용 모듈에만 있다). */
const CITATION_ATTRIBUTION_DISPLAY_VERSION = "0.1.0";

type UserClient = SupabaseClient<Database>;
type Obj = Record<string, unknown>;

const RESOLVE_FUNCTION = "visibility-competitor-resolve";
const DETAIL_FUNCTION = "visibility-competitor-detail";
const COMPARE_FUNCTION = "visibility-competitor-compare";

function isObj(value: unknown): value is Obj {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function str(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nullableNum(value: unknown): { ok: true; value: number | null } | { ok: false } {
  if (value === null) return { ok: true, value: null };
  const n = num(value);
  return n === null ? { ok: false } : { ok: true, value: n };
}

function nullableStr(value: unknown): { ok: true; value: string | null } | { ok: false } {
  if (value === null) return { ok: true, value: null };
  const v = str(value);
  return v === null ? { ok: false } : { ok: true, value: v };
}

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

/** Edge Function 오류 코드는 내부 정보이므로 고객 노출용 최소 코드로만 축약한다. */
function asErrorCode(value: unknown): CompetitorErrorCode {
  return value === "FORBIDDEN" ? "FORBIDDEN" : "NOT_AVAILABLE";
}

async function invokeFunction(
  supabase: UserClient,
  fn: string,
  body: Obj,
): Promise<{ ok: true; payload: Obj } | { ok: false; error: CompetitorErrorCode }> {
  const { data, error } = await supabase.functions.invoke(fn, { body });

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
      console.error(`[visibility-competitor] ${fn} invoke failed`);
      return { ok: false, error: "INTERNAL_ERROR" };
    }
  } else {
    payload = isObj(data) ? data : null;
  }

  if (!payload) return { ok: false, error: "INTERNAL_ERROR" };
  if (payload["ok"] !== true) return { ok: false, error: asErrorCode(payload["error"]) };
  return { ok: true, payload };
}

function parseScope(value: unknown): CompetitorScopeDTO | null {
  if (!isObj(value)) return null;
  const runId = str(value["runId"]);
  const runName = str(value["runName"]);
  const measuredAt = str(value["measuredAt"]);
  if (runId === null || runName === null || measuredAt === null) return null;
  return { runId, runName, measuredAt };
}

function parseBusiness(value: unknown): CompetitorBusinessDTO | null {
  if (!isObj(value)) return null;
  const id = str(value["id"]);
  const name = str(value["name"]);
  if (id === null || name === null) return null;
  return { id, name };
}

function parseCompetitor(value: unknown): CompetitorSummaryDTO | null {
  if (!isObj(value)) return null;
  const ref = str(value["ref"]);
  const name = str(value["name"]);
  const mentionCount = num(value["mentionCount"]);
  const responseCount = num(value["responseCount"]);
  const top3ResponseCount = num(value["top3ResponseCount"]);
  const responseRatePct = nullableNum(value["responseRatePct"]);
  const top3RatePct = nullableNum(value["top3RatePct"]);
  if (
    ref === null ||
    name === null ||
    mentionCount === null ||
    responseCount === null ||
    top3ResponseCount === null ||
    !responseRatePct.ok ||
    !top3RatePct.ok
  ) {
    return null;
  }
  return {
    ref,
    name,
    mentionCount,
    responseCount,
    responseRatePct: responseRatePct.value,
    top3ResponseCount,
    top3RatePct: top3RatePct.value,
  };
}

function parseQuestionGroup(o: Obj): CompetitorQuestionGroupDTO | null {
  const intentType = str(o["intentType"]);
  const questionCount = num(o["questionCount"]);
  const measurementCount = num(o["measurementCount"]);
  const responseCount = num(o["responseCount"]);
  const mentionCount = num(o["mentionCount"]);
  const responseRatePct = nullableNum(o["responseRatePct"]);
  const top3RatePct = nullableNum(o["top3RatePct"]);
  if (
    intentType === null ||
    questionCount === null ||
    measurementCount === null ||
    responseCount === null ||
    mentionCount === null ||
    !responseRatePct.ok ||
    !top3RatePct.ok
  ) {
    return null;
  }
  return {
    intentType,
    questionCount,
    measurementCount,
    responseCount,
    mentionCount,
    responseRatePct: responseRatePct.value,
    top3RatePct: top3RatePct.value,
  };
}

function parseQuestion(o: Obj): CompetitorQuestionDTO | null {
  const questionId = str(o["questionId"]);
  const questionText = str(o["questionText"]);
  const intentType = str(o["intentType"]);
  const measurementCount = num(o["measurementCount"]);
  const responseCount = num(o["responseCount"]);
  const mentionCount = num(o["mentionCount"]);
  const top3ResponseCount = num(o["top3ResponseCount"]);
  const responseRatePct = nullableNum(o["responseRatePct"]);
  const top3RatePct = nullableNum(o["top3RatePct"]);
  const bestPosition = nullableNum(o["bestPosition"]);
  if (
    questionId === null ||
    questionText === null ||
    intentType === null ||
    measurementCount === null ||
    responseCount === null ||
    mentionCount === null ||
    top3ResponseCount === null ||
    !responseRatePct.ok ||
    !top3RatePct.ok ||
    !bestPosition.ok
  ) {
    return null;
  }
  return {
    questionId,
    questionText,
    intentType,
    measurementCount,
    responseCount,
    mentionCount,
    responseRatePct: responseRatePct.value,
    top3ResponseCount,
    top3RatePct: top3RatePct.value,
    bestPosition: bestPosition.value,
  };
}

function parseSource(o: Obj): CompetitorSourceDTO | null {
  const domain = str(o["domain"]);
  const citationCount = num(o["citationCount"]);
  const responseCount = num(o["responseCount"]);
  const responseRatePct = nullableNum(o["responseRatePct"]);
  const sampleTitle = nullableStr(o["sampleTitle"]);
  if (
    domain === null ||
    citationCount === null ||
    responseCount === null ||
    !responseRatePct.ok ||
    !sampleTitle.ok
  ) {
    return null;
  }
  return {
    domain,
    citationCount,
    responseCount,
    responseRatePct: responseRatePct.value,
    sampleTitle: sampleTitle.value,
  };
}

export function parseCompetitorDetailPayload(payload: Obj): CompetitorDetailResponseDTO {
  const generatedAt = str(payload["generatedAt"]);
  const scope = parseScope(payload["scope"]);
  const business = parseBusiness(payload["business"]);
  const competitor = parseCompetitor(payload["competitor"]);
  const questionGroups = strictArray(payload["questionGroups"], parseQuestionGroup);
  const questions = strictArray(payload["questions"], parseQuestion);
  const sources = strictArray(payload["sources"], parseSource);
  if (
    generatedAt === null ||
    scope === null ||
    business === null ||
    competitor === null ||
    questionGroups === null ||
    questions === null ||
    sources === null
  ) {
    return { ok: false, error: "INVALID_DTO" };
  }
  const detail: CompetitorDetailDTO = {
    generatedAt,
    scope,
    business,
    competitor,
    questionGroups,
    questions,
    sources,
  };
  return { ok: true, detail };
}

export async function resolveVisibilityCompetitor(args: {
  supabase: UserClient;
  orgId: string;
  businessId: string;
  competitorName: string;
}): Promise<CompetitorResolveResponseDTO> {
  const res = await invokeFunction(args.supabase, RESOLVE_FUNCTION, {
    orgId: args.orgId,
    businessId: args.businessId,
    competitorName: args.competitorName,
  });
  if (!res.ok) return res;

  const competitor = res.payload["competitor"];
  if (!isObj(competitor)) return { ok: false, error: "INVALID_DTO" };
  const name = str(competitor["name"]);
  const ref = str(competitor["ref"]);
  if (name === null || ref === null) return { ok: false, error: "INVALID_DTO" };
  return { ok: true, competitor: { name, ref } };
}

export async function fetchVisibilityCompetitorDetail(args: {
  supabase: UserClient;
  orgId: string;
  businessId: string;
  competitorRef: string;
}): Promise<CompetitorDetailResponseDTO> {
  const res = await invokeFunction(args.supabase, DETAIL_FUNCTION, {
    orgId: args.orgId,
    businessId: args.businessId,
    competitorRef: args.competitorRef,
  });
  if (!res.ok) return res;
  return parseCompetitorDetailPayload(res.payload);
}

function parseCompareOverview(value: unknown): CompetitorCompareOverviewDTO | null {
  if (!isObj(value)) return null;
  const validCount = num(value["validCount"]);
  const clientResponseCount = num(value["clientResponseCount"]);
  const clientResponseRatePct = nullableNum(value["clientResponseRatePct"]);
  const clientTop3ResponseCount = num(value["clientTop3ResponseCount"]);
  const clientTop3RatePct = nullableNum(value["clientTop3RatePct"]);
  const competitorResponseCount = num(value["competitorResponseCount"]);
  const competitorResponseRatePct = nullableNum(value["competitorResponseRatePct"]);
  const competitorTop3ResponseCount = num(value["competitorTop3ResponseCount"]);
  const competitorTop3RatePct = nullableNum(value["competitorTop3RatePct"]);
  if (
    validCount === null ||
    clientResponseCount === null ||
    !clientResponseRatePct.ok ||
    clientTop3ResponseCount === null ||
    !clientTop3RatePct.ok ||
    competitorResponseCount === null ||
    !competitorResponseRatePct.ok ||
    competitorTop3ResponseCount === null ||
    !competitorTop3RatePct.ok
  ) {
    return null;
  }
  return {
    validCount,
    clientResponseCount,
    clientResponseRatePct: clientResponseRatePct.value,
    clientTop3ResponseCount,
    clientTop3RatePct: clientTop3RatePct.value,
    competitorResponseCount,
    competitorResponseRatePct: competitorResponseRatePct.value,
    competitorTop3ResponseCount,
    competitorTop3RatePct: competitorTop3RatePct.value,
  };
}

function parseCompareGroup(o: Obj): CompetitorCompareQuestionGroupDTO | null {
  const intentType = str(o["intentType"]);
  const questionCount = num(o["questionCount"]);
  const measurementCount = num(o["measurementCount"]);
  const clientResponseCount = num(o["clientResponseCount"]);
  const clientResponseRatePct = nullableNum(o["clientResponseRatePct"]);
  const clientTop3ResponseCount = num(o["clientTop3ResponseCount"]);
  const clientTop3RatePct = nullableNum(o["clientTop3RatePct"]);
  const competitorResponseCount = num(o["competitorResponseCount"]);
  const competitorResponseRatePct = nullableNum(o["competitorResponseRatePct"]);
  const competitorTop3ResponseCount = num(o["competitorTop3ResponseCount"]);
  const competitorTop3RatePct = nullableNum(o["competitorTop3RatePct"]);
  if (
    intentType === null ||
    questionCount === null ||
    measurementCount === null ||
    clientResponseCount === null ||
    !clientResponseRatePct.ok ||
    clientTop3ResponseCount === null ||
    !clientTop3RatePct.ok ||
    competitorResponseCount === null ||
    !competitorResponseRatePct.ok ||
    competitorTop3ResponseCount === null ||
    !competitorTop3RatePct.ok
  ) {
    return null;
  }
  return {
    intentType,
    questionCount,
    measurementCount,
    clientResponseCount,
    clientResponseRatePct: clientResponseRatePct.value,
    clientTop3ResponseCount,
    clientTop3RatePct: clientTop3RatePct.value,
    competitorResponseCount,
    competitorResponseRatePct: competitorResponseRatePct.value,
    competitorTop3ResponseCount,
    competitorTop3RatePct: competitorTop3RatePct.value,
  };
}

function parseCompareQuestion(o: Obj): CompetitorCompareQuestionDTO | null {
  const base = parseCompareGroup({ ...o, questionCount: 0 });
  const questionId = str(o["questionId"]);
  const questionText = str(o["questionText"]);
  const clientBestPosition = nullableNum(o["clientBestPosition"]);
  const competitorBestPosition = nullableNum(o["competitorBestPosition"]);
  const bothResponseCount = num(o["bothResponseCount"]);
  if (
    base === null ||
    questionId === null ||
    questionText === null ||
    !clientBestPosition.ok ||
    !competitorBestPosition.ok ||
    bothResponseCount === null
  ) {
    return null;
  }
  return {
    questionId,
    questionText,
    intentType: base.intentType,
    measurementCount: base.measurementCount,
    clientResponseCount: base.clientResponseCount,
    clientResponseRatePct: base.clientResponseRatePct,
    clientTop3ResponseCount: base.clientTop3ResponseCount,
    clientTop3RatePct: base.clientTop3RatePct,
    clientBestPosition: clientBestPosition.value,
    competitorResponseCount: base.competitorResponseCount,
    competitorResponseRatePct: base.competitorResponseRatePct,
    competitorTop3ResponseCount: base.competitorTop3ResponseCount,
    competitorTop3RatePct: base.competitorTop3RatePct,
    competitorBestPosition: competitorBestPosition.value,
    bothResponseCount,
  };
}

function parseCompareSource(o: Obj): CompetitorCompareSourceDTO | null {
  const domain = str(o["domain"]);
  const observedInRaw = str(o["observedIn"]);
  const observedIn: CompetitorCompareObservedIn | null =
    observedInRaw === "both" || observedInRaw === "client_only" || observedInRaw === "competitor_only"
      ? observedInRaw
      : null;
  const clientCitationCount = num(o["clientCitationCount"]);
  const clientResponseCount = num(o["clientResponseCount"]);
  const clientResponseRatePct = nullableNum(o["clientResponseRatePct"]);
  const competitorCitationCount = num(o["competitorCitationCount"]);
  const competitorResponseCount = num(o["competitorResponseCount"]);
  const competitorResponseRatePct = nullableNum(o["competitorResponseRatePct"]);
  const sampleTitle = nullableStr(o["sampleTitle"]);
  if (
    domain === null ||
    observedIn === null ||
    clientCitationCount === null ||
    clientResponseCount === null ||
    !clientResponseRatePct.ok ||
    competitorCitationCount === null ||
    competitorResponseCount === null ||
    !competitorResponseRatePct.ok ||
    !sampleTitle.ok
  ) {
    return null;
  }
  return {
    domain,
    observedIn,
    clientCitationCount,
    clientResponseCount,
    clientResponseRatePct: clientResponseRatePct.value,
    competitorCitationCount,
    competitorResponseCount,
    competitorResponseRatePct: competitorResponseRatePct.value,
    sampleTitle: sampleTitle.value,
  };
}

function parseCompetitorRef(value: unknown): CompetitorRefDTO | null {
  if (!isObj(value)) return null;
  const name = str(value["name"]);
  const ref = str(value["ref"]);
  if (name === null || ref === null) return null;
  return { name, ref };
}

export function parseCompetitorComparePayload(payload: Obj): CompetitorCompareResponseDTO {
  const generatedAt = str(payload["generatedAt"]);
  const scope = parseScope(payload["scope"]);
  const business = parseBusiness(payload["business"]);
  const competitor = parseCompetitorRef(payload["competitor"]);
  const overview = parseCompareOverview(payload["overview"]);
  const questionGroups = strictArray(payload["questionGroups"], parseCompareGroup);
  const questions = strictArray(payload["questions"], parseCompareQuestion);
  const sources = strictArray(payload["sources"], parseCompareSource);
  if (
    generatedAt === null ||
    scope === null ||
    business === null ||
    competitor === null ||
    overview === null ||
    questionGroups === null ||
    questions === null ||
    sources === null
  ) {
    return { ok: false, error: "INVALID_DTO" };
  }
  return {
    ok: true,
    compare: {
      generatedAt,
      scope,
      business,
      competitor,
      overview,
      questionGroups,
      questions,
      sources,
      attributedSources: [],
    },
  };
}

/**
 * 저장된 attribution row(`measurement_citation_attributions`)를 도메인 단위로
 * 세기만 한다. 판정 규칙은 attribution 파이프라인에만 존재하며, RLS가 적용된
 * 사용자 클라이언트로 읽으므로 조직 범위를 벗어나지 않는다.
 * 실패하면 조용히 빈 배열을 돌려 기존 co-occurrence 표시만 유지한다.
 */
async function loadAttributedSources(args: {
  supabase: UserClient;
  orgId: string;
  businessId: string;
  runId: string;
  competitorRef: string;
  competitorName: string;
}): Promise<CompetitorAttributedSourceDTO[]> {
  const { data, error } = await args.supabase
    .from("measurement_citation_attributions")
    .select("domain, title, measurement_id, canonical_key, canonical_display_name, attribution_level")
    .eq("org_id", args.orgId)
    .eq("business_id", args.businessId)
    .eq("source_run_id", args.runId)
    .eq("attribution_version", CITATION_ATTRIBUTION_DISPLAY_VERSION);
  if (error || !data) return [];
  return aggregateAttributedSources({
    rows: data as AttributionAggregateRow[],
    clientKey: `business:${args.businessId}`,
    competitorKey: args.competitorRef,
    competitorName: args.competitorName,
  });
}

export async function fetchVisibilityCompetitorCompare(args: {
  supabase: UserClient;
  orgId: string;
  businessId: string;
  competitorRef: string;
}): Promise<CompetitorCompareResponseDTO> {
  const res = await invokeFunction(args.supabase, COMPARE_FUNCTION, {
    orgId: args.orgId,
    businessId: args.businessId,
    competitorRef: args.competitorRef,
  });
  if (!res.ok) return res;
  const parsed = parseCompetitorComparePayload(res.payload);
  if (!parsed.ok) return parsed;
  const attributedSources = await loadAttributedSources({
    supabase: args.supabase,
    orgId: args.orgId,
    businessId: args.businessId,
    runId: parsed.compare.scope.runId,
    competitorRef: args.competitorRef,
    competitorName: parsed.compare.competitor.name,
  });
  return { ok: true, compare: { ...parsed.compare, attributedSources } };
}
