// Core Engine Isolation: 이 파일은 Supabase Edge Function `visibility-diagnostic`
// 호출 wrapper이다. 진단 계산 규칙(대표 run 선택, 경쟁업체 판정, 출처 집계,
// 우선순위 산식)은 이 저장소에 없다. 요청은 현재 사용자 JWT로 전송되며
// `{ orgId, businessId }` 최소 식별자만 보낸다. 응답은 형태 검증만 수행한다.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type {
  VisibilityDiagnosticDTO,
  VisibilityClusterDTO,
  VisibilityCompetitorDTO,
  VisibilitySourceDTO,
  VisibilityPriorityDTO,
  VisibilityTrendPointDTO,
} from "./visibility-diagnostic.types";

type UserClient = SupabaseClient<Database>;

const DIAGNOSTIC_FUNCTION = "visibility-diagnostic";

type Obj = Record<string, unknown>;

function isObj(value: unknown): value is Obj {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** DTO 키 표기 차이(camel/snake)만 흡수한다. 값은 변형하지 않는다. */
function pick(obj: Obj, keys: readonly string[]): unknown {
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null) return obj[k];
  }
  return undefined;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asCount(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
}

/** Edge DTO가 비율(0~1) 또는 퍼센트(0~100) 중 어떤 표기든 퍼센트로 표시만 맞춘다. */
function asPercent(value: unknown): number | null {
  const n = asCount(value);
  if (n === null) return null;
  if (n >= 0 && n <= 1) return n * 100;
  return n;
}

function arrayOf<T>(value: unknown, map: (item: Obj) => T | null): T[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isObj).map(map).filter((v): v is T => v !== null);
}

function parseCluster(o: Obj): VisibilityClusterDTO | null {
  const label = asString(pick(o, ["label", "cluster_label", "name", "intent_type"]));
  if (!label) return null;
  return {
    label,
    question_count: asCount(pick(o, ["question_count", "questionCount"])) ?? 0,
    exposure_rate_pct: asPercent(
      pick(o, ["exposure_rate", "exposureRate", "mention_rate", "visibility_rate"]),
    ),
    standing: (() => {
      const s = asString(pick(o, ["standing", "strength", "level"]));
      return s === "strong" || s === "weak" || s === "mixed" ? s : null;
    })(),
  };
}

function parseCompetitor(o: Obj): VisibilityCompetitorDTO | null {
  const name = asString(pick(o, ["display_name", "canonical_display_name", "name"]));
  if (!name) return null;
  return {
    display_name: name,
    response_count: asCount(pick(o, ["response_count", "responseCount", "mention_count"])) ?? 0,
    share_pct: asPercent(pick(o, ["answer_share_pct", "share_pct", "share", "rate"])),
  };
}

function parseSource(o: Obj): VisibilitySourceDTO | null {
  const domain = asString(pick(o, ["domain", "source_domain", "host"]));
  if (!domain) return null;
  return {
    domain,
    citation_count: asCount(pick(o, ["citation_count", "count", "cited_count"])) ?? 0,
    share_pct: asPercent(pick(o, ["share_pct", "citation_rate", "rate"])),
    source_type: asString(pick(o, ["source_type", "type", "classification"])),
  };
}

function parsePriority(o: Obj): VisibilityPriorityDTO | null {
  const title = asString(pick(o, ["title", "question_text", "label", "area"]));
  if (!title) return null;
  return {
    title,
    detail: asString(pick(o, ["detail", "note", "rationale", "description"])),
    cluster_label: asString(pick(o, ["cluster_label", "intent_type", "cluster"])),
    exposure_rate_pct: asPercent(pick(o, ["exposure_rate", "mention_rate", "exposureRate"])),
  };
}

function parseTrendPoint(o: Obj): VisibilityTrendPointDTO | null {
  const at = asString(pick(o, ["observed_at", "completed_at", "date", "run_completed_at"]));
  if (!at) return null;
  return {
    observed_at: at,
    exposure_rate_pct: asPercent(pick(o, ["exposure_rate", "exposureRate", "mention_rate"])),
    valid_measurement_count: asCount(
      pick(o, ["valid_measurement_count", "measurement_count", "validMeasurementCount"]),
    ),
  };
}

/**
 * fail-closed: DTO 형태가 기대와 다르면 값을 추측해 채우지 않고 null을 돌려준다.
 */
export function parseVisibilityDiagnostic(payload: unknown): VisibilityDiagnosticDTO | null {
  if (!isObj(payload)) return null;
  const root = isObj(payload["diagnostic"]) ? (payload["diagnostic"] as Obj) : payload;

  const summaryRaw = pick(root, ["summary", "overview", "metrics", "kpis"]);
  const summary = isObj(summaryRaw) ? summaryRaw : root;

  const validCount = asCount(
    pick(summary, [
      "valid_measurement_count",
      "validMeasurementCount",
      "measurement_count",
      "eligible_measurement_count",
    ]),
  );
  if (validCount === null) return null;

  const clusters = arrayOf(
    pick(root, ["clusters", "question_clusters", "intent_clusters"]),
    parseCluster,
  );
  const competitors = arrayOf(pick(root, ["competitors", "substitutes", "competitor_share"]), parseCompetitor);
  const sources = arrayOf(pick(root, ["sources", "source_domains", "citations"]), parseSource);
  const priorities = arrayOf(pick(root, ["priorities", "priority_areas", "focus_areas", "actions"]), parsePriority);
  const trend = arrayOf(pick(root, ["trend", "trend_points", "history", "timeline"]), parseTrendPoint);

  return {
    business_name: asString(pick(root, ["business_name", "businessName"])),
    latest_observed_at: asString(
      pick(root, ["latest_observed_at", "observed_at", "completed_at", "generated_at"]),
    ),
    run_count: asCount(pick(root, ["run_count", "runCount"])),
    summary: {
      valid_measurement_count: validCount,
      exposure_rate_pct: asPercent(
        pick(summary, ["exposure_rate", "exposureRate", "visibility_rate", "mention_rate"]),
      ),
      top3_rate_pct: asPercent(pick(summary, ["top3_rate", "top3Rate", "top3_exposure_rate"])),
      exposed_question_rate_pct: asPercent(
        pick(summary, [
          "exposed_question_rate",
          "exposedQuestionRate",
          "question_exposure_rate",
          "question_coverage_rate",
        ]),
      ),
      exposed_measurement_count: asCount(
        pick(summary, ["exposed_measurement_count", "mentioned_count", "exposure_count"]),
      ),
      question_count: asCount(pick(summary, ["question_count", "questionCount"])),
      exposed_question_count: asCount(
        pick(summary, ["exposed_question_count", "exposedQuestionCount", "covered_question_count"]),
      ),
    },
    clusters,
    competitors,
    sources,
    priorities,
    trend,
  };
}

export type VisibilityDiagnosticResult =
  | { ok: true; diagnostic: VisibilityDiagnosticDTO }
  | { ok: false; error: "NO_DATA" | "FORBIDDEN" | "INVALID_DTO" | "INTERNAL_ERROR" };

function asErrorCode(value: unknown): VisibilityDiagnosticResult extends never ? never : "NO_DATA" | "FORBIDDEN" | "INTERNAL_ERROR" {
  if (value === "NO_DATA" || value === "FORBIDDEN") return value;
  return "INTERNAL_ERROR";
}

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
        payload = (await ctx.clone().json()) as Obj;
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
  if (payload["ok"] === false || typeof payload["error"] === "string") {
    return { ok: false, error: asErrorCode(payload["error"] ?? payload["code"]) };
  }

  const diagnostic = parseVisibilityDiagnostic(payload);
  if (!diagnostic) return { ok: false, error: "INVALID_DTO" };
  if (diagnostic.summary.valid_measurement_count <= 0) return { ok: false, error: "NO_DATA" };
  return { ok: true, diagnostic };
}
