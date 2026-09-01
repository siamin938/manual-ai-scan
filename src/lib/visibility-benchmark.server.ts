// Core Engine Isolation: `visibility-benchmark` Edge Function 호출 wrapper.
// 고노출 기준/출처 그룹핑/패턴 강도 판정 규칙은 이 저장소에 없다. 최소 식별자만
// 보내고, 응답은 계약 형태만 검증한 뒤 값을 그대로 사용한다(재계산 금지).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type {
  BenchmarkPatternStrength,
  BenchmarkSourceGroupDTO,
  BenchmarkSourceSiteDTO,
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

function parseSite(item: unknown): BenchmarkSourceSiteDTO | null {
  if (!isObj(item)) return null;
  const label = str(item["label"]);
  if (label === null) return null;
  const domain = str(item["domain"]);
  return domain === null ? { label } : { label, domain };
}

function parseSites(value: unknown): BenchmarkSourceSiteDTO[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return null;
  const sites: BenchmarkSourceSiteDTO[] = [];
  for (const item of value) {
    const parsed = parseSite(item);
    if (parsed === null) return null;
    sites.push(parsed);
  }
  return sites;
}

function parseSourceGroup(item: unknown, index: number): BenchmarkSourceGroupDTO | null {
  if (!isObj(item)) return null;
  const label = str(item["label"]) ?? str(item["groupLabel"]) ?? str(item["name"]);
  const highEntityCount = num(item["highEntityCount"]);
  if (label === null || highEntityCount === null) return null;
  const key = str(item["key"]) ?? str(item["groupKey"]) ?? `${label}-${index}`;
  const targetRaw = item["targetConnected"] ?? item["targetLinked"] ?? item["hasTargetConnection"];
  const sites = parseSites(item["sites"]);
  if (sites === null) return null;
  return {
    key,
    label,
    highEntityCount,
    highEntitySharePct: nullableNum(item["highEntitySharePct"]),
    targetConnected: targetRaw === true,
    patternStrength: parseStrength(item["patternStrength"]),
    sites,
  };
}


function parseCategorySourceGroup(
  item: unknown,
  index: number,
): BenchmarkCategorySourceGroupDTO | null {
  if (!isObj(item)) return null;
  const label = str(item["label"]) ?? str(item["groupLabel"]) ?? str(item["name"]);
  const highEntityCount = num(item["highEntityCount"]);
  if (label === null || highEntityCount === null) return null;
  const sites = parseSites(item["sites"]);
  if (sites === null) return null;
  return {
    key: str(item["key"]) ?? str(item["groupKey"]) ?? `${label}-${index}`,
    label,
    highEntityCount,
    highEntitySharePct: nullableNum(item["highEntitySharePct"]),
    sites,
  };
}

function parseCategoryContext(value: unknown): BenchmarkCategoryContextDTO | undefined {
  if (!isObj(value)) return undefined;
  const groupsRaw = value["sourceGroups"];
  const sourceGroups: BenchmarkCategorySourceGroupDTO[] = [];
  if (Array.isArray(groupsRaw)) {
    for (let i = 0; i < groupsRaw.length; i += 1) {
      const parsed = parseCategorySourceGroup(groupsRaw[i], i);
      if (parsed !== null) sourceGroups.push(parsed);
    }
  }
  return {
    available: value["available"] === true,
    category: str(value["category"]),
    eligibleTargetBusinessCount: num(value["eligibleTargetBusinessCount"]) ?? 0,
    highVisibilityEntityCount: num(value["highVisibilityEntityCount"]) ?? 0,
    sourceGroups,
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

  const dto: VisibilityBenchmarkDTO = {
    windowDays,
    thresholdPct,
    dataStatus,
    highVisibilityEntityCount,
    sourceGroups,
    disclaimer,
  };

  if (value["scope"] === "global_automotive") dto.scope = "global_automotive";
  const eligible = num(value["eligibleTargetBusinessCount"]);
  if (eligible !== null) dto.eligibleTargetBusinessCount = eligible;
  const orgs = num(value["contributingOrgCount"]);
  if (orgs !== null) dto.contributingOrgCount = orgs;
  const categoryContext = parseCategoryContext(value["categoryContext"]);
  if (categoryContext !== undefined) dto.categoryContext = categoryContext;

  return dto;
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
