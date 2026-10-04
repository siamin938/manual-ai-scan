import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type PilotOpsStage =
  | "inactive"
  | "questions_needed"
  | "questions_review"
  | "first_measurement_needed"
  | "measurement_in_progress"
  | "result_ready"
  | "measurement_review";

export type PilotOpsBusinessDTO = {
  orgId: string;
  orgName: string;
  ownerName: string | null;
  ownerEmail: string | null;
  creditBalance: number;
  businessId: string;
  businessName: string;
  category: string;
  region: string | null;
  city: string | null;
  businessActive: boolean;
  questionSetId: string | null;
  questionSetName: string | null;
  activeQuestionCount: number;
  latestRunId: string | null;
  latestRunName: string | null;
  latestRunStatus: string | null;
  totalJobs: number | null;
  completedJobs: number | null;
  failedJobs: number | null;
  latestRunCreatedAt: string | null;
  latestRunCompletedAt: string | null;
  stage: PilotOpsStage;
  nextAction: string;
};

export type PilotOpsOverviewDTO = {
  version: string;
  generatedAt: string;
  query: string;
  totalMatches: number;
  businesses: PilotOpsBusinessDTO[];
};

export type PilotOpsOverviewResponseDTO =
  | { ok: true; overview: PilotOpsOverviewDTO }
  | { ok: false; error: "FORBIDDEN" | "NOT_AVAILABLE" };

type RpcCaller = {
  rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
};

const STAGES: PilotOpsStage[] = [
  "inactive",
  "questions_needed",
  "questions_review",
  "first_measurement_needed",
  "measurement_in_progress",
  "result_ready",
  "measurement_review",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function nullableStr(value: unknown): string | null | undefined {
  if (value === null) return null;
  return typeof value === "string" ? value : undefined;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nullableNum(value: unknown): number | null | undefined {
  if (value === null) return null;
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function parseBusiness(value: unknown): PilotOpsBusinessDTO | null {
  if (!isRecord(value)) return null;

  const orgId = str(value["orgId"]);
  const orgName = str(value["orgName"]);
  const ownerName = nullableStr(value["ownerName"]);
  const ownerEmail = nullableStr(value["ownerEmail"]);
  const creditBalance = num(value["creditBalance"]);
  const businessId = str(value["businessId"]);
  const businessName = str(value["businessName"]);
  const category = str(value["category"]);
  const region = nullableStr(value["region"]);
  const city = nullableStr(value["city"]);
  const businessActive = value["businessActive"];
  const questionSetId = nullableStr(value["questionSetId"]);
  const questionSetName = nullableStr(value["questionSetName"]);
  const activeQuestionCount = num(value["activeQuestionCount"]);
  const latestRunId = nullableStr(value["latestRunId"]);
  const latestRunName = nullableStr(value["latestRunName"]);
  const latestRunStatus = nullableStr(value["latestRunStatus"]);
  const totalJobs = nullableNum(value["totalJobs"]);
  const completedJobs = nullableNum(value["completedJobs"]);
  const failedJobs = nullableNum(value["failedJobs"]);
  const latestRunCreatedAt = nullableStr(value["latestRunCreatedAt"]);
  const latestRunCompletedAt = nullableStr(value["latestRunCompletedAt"]);
  const stage = str(value["stage"]);
  const nextAction = str(value["nextAction"]);

  if (
    !orgId ||
    !orgName ||
    ownerName === undefined ||
    ownerEmail === undefined ||
    creditBalance === null ||
    !businessId ||
    !businessName ||
    category === null ||
    region === undefined ||
    city === undefined ||
    typeof businessActive !== "boolean" ||
    questionSetId === undefined ||
    questionSetName === undefined ||
    activeQuestionCount === null ||
    latestRunId === undefined ||
    latestRunName === undefined ||
    latestRunStatus === undefined ||
    totalJobs === undefined ||
    completedJobs === undefined ||
    failedJobs === undefined ||
    latestRunCreatedAt === undefined ||
    latestRunCompletedAt === undefined ||
    !stage ||
    !STAGES.includes(stage as PilotOpsStage) ||
    !nextAction
  ) {
    return null;
  }

  return {
    orgId,
    orgName,
    ownerName,
    ownerEmail,
    creditBalance,
    businessId,
    businessName,
    category,
    region,
    city,
    businessActive,
    questionSetId,
    questionSetName,
    activeQuestionCount,
    latestRunId,
    latestRunName,
    latestRunStatus,
    totalJobs,
    completedJobs,
    failedJobs,
    latestRunCreatedAt,
    latestRunCompletedAt,
    stage: stage as PilotOpsStage,
    nextAction,
  };
}

function parseOverview(value: unknown): PilotOpsOverviewDTO | null {
  if (!isRecord(value)) return null;
  const version = str(value["version"]);
  const generatedAt = str(value["generatedAt"]);
  const query = str(value["query"]);
  const totalMatches = num(value["totalMatches"]);
  const rawBusinesses = value["businesses"];
  if (!version || !generatedAt || query === null || totalMatches === null || !Array.isArray(rawBusinesses)) {
    return null;
  }

  const businesses: PilotOpsBusinessDTO[] = [];
  for (const item of rawBusinesses) {
    const parsed = parseBusiness(item);
    if (!parsed) return null;
    businesses.push(parsed);
  }

  return { version, generatedAt, query, totalMatches, businesses };
}

export const getPilotOpsAdminOverview = createServerFn({ method: "POST" })
  .inputValidator((input: { query?: string } | undefined) => {
    if (input === undefined || input === null) return { query: null };
    if (!isRecord(input)) throw new Error("INVALID_INPUT");
    const query = input["query"];
    if (query === undefined || query === null) return { query: null };
    if (typeof query !== "string") throw new Error("INVALID_INPUT");
    const trimmed = query.trim();
    if (trimmed.length > 100) throw new Error("INVALID_INPUT");
    return { query: trimmed.length > 0 ? trimmed : null };
  })
  .middleware([requireSupabaseAuth])
  .handler(async ({ data: input, context }): Promise<PilotOpsOverviewResponseDTO> => {
    const client = context.supabase as unknown as RpcCaller;

    const permission = await client.rpc("can_view_data_asset_admin_v01");
    if (permission.error || permission.data !== true) {
      return { ok: false, error: "FORBIDDEN" };
    }

    const { data, error } = await client.rpc("get_pilot_ops_admin_overview_v01", {
      p_query: input.query,
      p_limit: 100,
    });
    if (error) return { ok: false, error: "NOT_AVAILABLE" };

    const overview = parseOverview(data);
    if (!overview) return { ok: false, error: "NOT_AVAILABLE" };
    return { ok: true, overview };
  });
