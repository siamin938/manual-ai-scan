// Core Engine Isolation: 이 파일은 Supabase Edge Function
// `visibility-competitor-resolve` / `visibility-competitor-detail` 호출 wrapper이다.
// canonical 매칭, 집계, 정렬 규칙은 이 저장소에 없다. 요청은 현재 사용자 JWT로
// 전송되며 최소 식별자만 보낸다. 응답은 계약 형태만 엄격 검증하고 숫자는 그대로 쓴다.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type {
  CompetitorBusinessDTO,
  CompetitorDetailDTO,
  CompetitorDetailResponseDTO,
  CompetitorErrorCode,
  CompetitorQuestionDTO,
  CompetitorQuestionGroupDTO,
  CompetitorResolveResponseDTO,
  CompetitorScopeDTO,
  CompetitorSourceDTO,
  CompetitorSummaryDTO,
} from "./visibility-competitor.types";

type UserClient = SupabaseClient<Database>;
type Obj = Record<string, unknown>;

const RESOLVE_FUNCTION = "visibility-competitor-resolve";
const DETAIL_FUNCTION = "visibility-competitor-detail";

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
