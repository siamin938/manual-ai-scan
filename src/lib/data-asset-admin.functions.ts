import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** 내부 운영자 전용 데이터 자산 개요 DTO (읽기 전용). */
export type DataAssetOriginDTO = {
  origin: "internal_observation" | "customer_measurement" | "demo";
  organizationCount: number;
  runCount: number;
  completedRunCount: number;
  validMeasurementCount: number;
  realBusinessCount: number;
  latestCompletedAt: string | null;
};

export type DataAssetBenchmark90dDTO = {
  eligibleRunCount: number;
  realBusinessCount: number;
  contributingOriginCount: number;
  latestMeasuredAt: string | null;
  includedOrigins: string[];
  businessIdentityVersion: string;
};

export type DataAssetOverviewDTO = {
  version: string;
  generatedAt: string;
  origins: DataAssetOriginDTO[];
  benchmark90d: DataAssetBenchmark90dDTO;
};

export type DataAssetOverviewResponseDTO =
  | { ok: true; overview: DataAssetOverviewDTO }
  | { ok: false; error: "FORBIDDEN" | "NOT_AVAILABLE" };

type RpcCaller = {
  rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
};

const ORIGINS = ["internal_observation", "customer_measurement", "demo"] as const;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function nullableStr(v: unknown): string | null | undefined {
  if (v === null) return null;
  return typeof v === "string" ? v : undefined;
}

function parseOrigin(v: unknown): DataAssetOriginDTO | null {
  if (!isRecord(v)) return null;
  const origin = v['origin'];
  if (typeof origin !== "string" || !(ORIGINS as readonly string[]).includes(origin)) return null;
  const organizationCount = num(v['organizationCount']);
  const runCount = num(v['runCount']);
  const completedRunCount = num(v['completedRunCount']);
  const validMeasurementCount = num(v['validMeasurementCount']);
  const realBusinessCount = num(v['realBusinessCount']);
  const latestCompletedAt = nullableStr(v['latestCompletedAt']);
  if (
    organizationCount === null ||
    runCount === null ||
    completedRunCount === null ||
    validMeasurementCount === null ||
    realBusinessCount === null ||
    latestCompletedAt === undefined
  ) {
    return null;
  }
  return {
    origin: origin as DataAssetOriginDTO["origin"],
    organizationCount,
    runCount,
    completedRunCount,
    validMeasurementCount,
    realBusinessCount,
    latestCompletedAt,
  };
}

function parseBenchmark(v: unknown): DataAssetBenchmark90dDTO | null {
  if (!isRecord(v)) return null;
  const eligibleRunCount = num(v['eligibleRunCount']);
  const realBusinessCount = num(v['realBusinessCount']);
  const contributingOriginCount = num(v['contributingOriginCount']);
  const latestMeasuredAt = nullableStr(v['latestMeasuredAt']);
  const includedOriginsRaw = v['includedOrigins'];
  const businessIdentityVersion = v['businessIdentityVersion'];
  if (
    eligibleRunCount === null ||
    realBusinessCount === null ||
    contributingOriginCount === null ||
    latestMeasuredAt === undefined ||
    !Array.isArray(includedOriginsRaw) ||
    !includedOriginsRaw.every((o): o is string => typeof o === "string") ||
    typeof businessIdentityVersion !== "string"
  ) {
    return null;
  }
  return {
    eligibleRunCount,
    realBusinessCount,
    contributingOriginCount,
    latestMeasuredAt,
    includedOrigins: includedOriginsRaw,
    businessIdentityVersion,
  };
}

function parseOverview(payload: unknown): DataAssetOverviewDTO | null {
  if (!isRecord(payload)) return null;
  const version = payload['version'];
  const generatedAt = payload['generatedAt'];
  const originsRaw = payload['origins'];
  if (typeof version !== "string" || typeof generatedAt !== "string" || !Array.isArray(originsRaw)) {
    return null;
  }
  const origins: DataAssetOriginDTO[] = [];
  for (const raw of originsRaw) {
    const parsed = parseOrigin(raw);
    if (!parsed) return null;
    origins.push(parsed);
  }
  const benchmark90d = parseBenchmark(payload['benchmark90d']);
  if (!benchmark90d) return null;
  return { version, generatedAt, origins, benchmark90d };
}

/** 현재 사용자가 데이터 자산 화면을 볼 수 있는지 여부. 실패 시 fail-closed(false). */
export const canViewDataAssetAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ allowed: boolean }> => {
    const client = context.supabase as unknown as RpcCaller;
    const { data, error } = await client.rpc("can_view_data_asset_admin_v01");
    if (error) return { allowed: false };
    return { allowed: data === true };
  });

/** 데이터 자산 개요. 권한/계약 위반 시 내부 payload를 노출하지 않고 구조화된 실패값 반환. */
export const getDataAssetAdminOverview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<DataAssetOverviewResponseDTO> => {
    const client = context.supabase as unknown as RpcCaller;

    const permission = await client.rpc("can_view_data_asset_admin_v01");
    if (permission.error || permission.data !== true) {
      return { ok: false, error: "FORBIDDEN" };
    }

    const { data, error } = await client.rpc("get_data_asset_admin_overview_v01");
    if (error) return { ok: false, error: "NOT_AVAILABLE" };

    const overview = parseOverview(data);
    if (!overview) return { ok: false, error: "NOT_AVAILABLE" };

    return { ok: true, overview };
  });
