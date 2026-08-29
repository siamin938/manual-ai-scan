// Core Engine Isolation: `visibility-benchmark` Edge Function 호출 wrapper.
// 고노출 기준/출처 그룹핑/패턴 강도 판정 규칙은 이 저장소에 없다. 최소 식별자만
// 보내고, 응답은 계약 형태만 검증한 뒤 값을 그대로 사용한다(재계산 금지).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type {
  BenchmarkPatternStrength,
  BenchmarkSourceGroupDTO,
  VisibilityBenchmarkDTO,
  VisibilityBenchmarkResponseDTO,
} from "./visibility-benchmark.types";

type UserClient = SupabaseClient<Database>;

const BENCHMARK_FUNCTION = "visibility-benchmark";

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

function nullableNum(value: unknown): number | null {
  const n = num(value);
  return n === null ? null : n;
}

function parseStrength(value: unknown): BenchmarkPatternStrength {
  return value === "emerging" || value === "established" ? value : "early";
}

function parseSourceGroup(item: unknown, index: number): BenchmarkSourceGroupDTO | null {
  if (!isObj(item)) return null;
  const label = str(item["label"]) ?? str(item["groupLabel"]) ?? str(item["name"]);
  const highEntityCount = num(item["highEntityCount"]);
  if (label === null || highEntityCount === null) return null;
  const key = str(item["key"]) ?? str(item["groupKey"]) ?? `${label}-${index}`;
  const targetRaw = item["targetConnected"] ?? item["targetLinked"] ?? item["hasTargetConnection"];
  return {
    key,
    label,
    highEntityCount,
    highEntitySharePct: nullableNum(item["highEntitySharePct"]),
    targetConnected: targetRaw === true,
    patternStrength: parseStrength(item["patternStrength"]),
  };
}

function parseBenchmark(value: unknown): VisibilityBenchmarkDTO | null {
  if (!isObj(value)) return null;
  const thresholdPct = num(value["thresholdPct"]);
  const highVisibilityEntityCount = num(value["highVisibilityEntityCount"]);
  const disclaimer = str(value["disclaimer"]);
  if (thresholdPct === null || highVisibilityEntityCount === null || disclaimer === null) {
    return null;
  }
  const windowDays = num(value["windowDays"]) ?? 90;
  const dataStatus = value["dataStatus"] === "ready" ? "ready" : "early";

  const groupsRaw = value["sourceGroups"];
  const sourceGroups: BenchmarkSourceGroupDTO[] = [];
  if (groupsRaw !== undefined && groupsRaw !== null) {
    if (!Array.isArray(groupsRaw)) return null;
    for (let i = 0; i < groupsRaw.length; i += 1) {
      const parsed = parseSourceGroup(groupsRaw[i], i);
      if (parsed === null) return null;
      sourceGroups.push(parsed);
    }
  }

  return {
    windowDays,
    thresholdPct,
    dataStatus,
    highVisibilityEntityCount,
    sourceGroups,
    disclaimer,
  };
}

export function parseVisibilityBenchmarkResponse(
  payload: unknown,
): VisibilityBenchmarkResponseDTO {
  if (!isObj(payload) || payload["ok"] !== true) return { ok: false, error: "INVALID_DTO" };

  if (payload["benchmark"] === null || payload["benchmark"] === undefined) {
    return { ok: true, benchmark: null };
  }

  const benchmark = parseBenchmark(payload["benchmark"]);
  if (benchmark === null) return { ok: false, error: "INVALID_DTO" };
  return { ok: true, benchmark };
}

export async function fetchVisibilityBenchmark(args: {
  supabase: UserClient;
  orgId: string;
  businessId: string;
}): Promise<VisibilityBenchmarkResponseDTO> {
  const { data, error } = await args.supabase.functions.invoke(BENCHMARK_FUNCTION, {
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
      console.error(`[visibility-benchmark] ${BENCHMARK_FUNCTION} invoke failed`);
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

  return parseVisibilityBenchmarkResponse(payload);
}
