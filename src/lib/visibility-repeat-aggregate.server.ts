// Core Engine Isolation: `visibility-repeat-aggregate` Edge Function 호출 wrapper.
// 호환성 판정/집계 규칙은 이 저장소에 없다. 최소 식별자만 보내고, 응답은
// 계약 형태만 엄격 검증한 뒤 숫자를 그대로 사용한다(재계산 금지).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type {
  VisibilityRepeatAggregateDTO,
  VisibilityRepeatAggregateResponseDTO,
} from "./visibility-diagnostic.types";

type UserClient = SupabaseClient<Database>;

const REPEAT_AGGREGATE_FUNCTION = "visibility-repeat-aggregate";

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

function nullableNum(value: unknown): { ok: true; value: number | null } | { ok: false } {
  if (value === null) return { ok: true, value: null };
  const n = num(value);
  return n === null ? { ok: false } : { ok: true, value: n };
}

function parseAggregate(value: unknown): VisibilityRepeatAggregateDTO | null {
  if (!isObj(value)) return null;
  if (value["compatibilityMode"] !== "strict_same_conditions") return null;
  const compatibleRunCount = num(value["compatibleRunCount"]);
  const measurementCount = num(value["measurementCount"]);
  const validCount = num(value["validCount"]);
  const mentionCount = num(value["mentionCount"]);
  const top3Count = num(value["top3Count"]);
  const questionCount = num(value["questionCount"]);
  const alwaysVisibleQuestionCount = num(value["alwaysVisibleQuestionCount"]);
  const sometimesVisibleQuestionCount = num(value["sometimesVisibleQuestionCount"]);
  const neverVisibleQuestionCount = num(value["neverVisibleQuestionCount"]);
  const visibilityRatePct = nullableNum(value["visibilityRatePct"]);
  const top3RatePct = nullableNum(value["top3RatePct"]);
  const windowStart = str(value["windowStart"]);
  const windowEnd = str(value["windowEnd"]);
  const latestRunId = str(value["latestRunId"]);
  if (
    compatibleRunCount === null ||
    measurementCount === null ||
    validCount === null ||
    mentionCount === null ||
    top3Count === null ||
    questionCount === null ||
    alwaysVisibleQuestionCount === null ||
    sometimesVisibleQuestionCount === null ||
    neverVisibleQuestionCount === null ||
    !visibilityRatePct.ok ||
    !top3RatePct.ok ||
    windowStart === null ||
    windowEnd === null ||
    latestRunId === null
  ) {
    return null;
  }
  return {
    compatibilityMode: "strict_same_conditions",
    compatibleRunCount,
    measurementCount,
    validCount,
    mentionCount,
    visibilityRatePct: visibilityRatePct.value,
    top3Count,
    top3RatePct: top3RatePct.value,
    questionCount,
    alwaysVisibleQuestionCount,
    sometimesVisibleQuestionCount,
    neverVisibleQuestionCount,
    windowStart,
    windowEnd,
    latestRunId,
  };
}

export function parseVisibilityRepeatAggregateResponse(
  payload: unknown,
): VisibilityRepeatAggregateResponseDTO {
  if (!isObj(payload) || payload["ok"] !== true) return { ok: false, error: "INVALID_DTO" };
  const generatedAt = str(payload["generatedAt"]);
  const business = isObj(payload["business"]) ? payload["business"] : null;
  const businessId = business ? str(business["id"]) : null;
  const businessName = business ? str(business["name"]) : null;
  if (generatedAt === null || businessId === null || businessName === null) {
    return { ok: false, error: "INVALID_DTO" };
  }

  if (payload["aggregate"] === null) {
    return {
      ok: true,
      generatedAt,
      business: { id: businessId, name: businessName },
      aggregate: null,
    };
  }

  const aggregate = parseAggregate(payload["aggregate"]);
  if (aggregate === null) return { ok: false, error: "INVALID_DTO" };

  return {
    ok: true,
    generatedAt,
    business: { id: businessId, name: businessName },
    aggregate,
  };
}

export async function fetchVisibilityRepeatAggregate(args: {
  supabase: UserClient;
  orgId: string;
  businessId: string;
}): Promise<VisibilityRepeatAggregateResponseDTO> {
  const { data, error } = await args.supabase.functions.invoke(REPEAT_AGGREGATE_FUNCTION, {
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
      console.error(`[visibility-repeat-aggregate] ${REPEAT_AGGREGATE_FUNCTION} invoke failed`);
      return { ok: false, error: "INTERNAL_ERROR" };
    }
  } else {
    payload = isObj(data) ? data : null;
  }

  if (!payload) return { ok: false, error: "INTERNAL_ERROR" };
  if (payload["ok"] !== true) {
    const code = str(payload["error"]);
    return { ok: false, error: code ?? "INTERNAL_ERROR" };
  }

  return parseVisibilityRepeatAggregateResponse(payload);
}
