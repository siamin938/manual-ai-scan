import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  businessNameIdentityKey,
  normalizeAliasList,
  normalizeBusinessName,
  normalizeOptionalPublicUrl,
} from "@/lib/business-registration.helpers";
import {
  buildUnifiedDiagnosticQuestionCandidates,
  hasUnifiedDiagnosticIntentShape,
  UNIFIED_DIAGNOSTIC_SET_PREFIX,
} from "@/lib/custom-question-suggestions";
import { resolveQuestionLocation } from "@/lib/question-suggestions";
import { reconcileInternalObservationPipelineItems } from "@/lib/internal-observation-reconciliation.functions";

export type InternalObservationPipelineStatus =
  | "pending"
  | "preparing"
  | "ready_to_measure"
  | "blocked"
  | "failed"
  | "measuring"
  | "postprocessing"
  | "completed"
  | "cancelled";

export type InternalObservationPipelineReadiness = {
  providerReady: boolean;
  creditBalance: number;
  executionEnabled: boolean;
  dailyRunLimit: number;
  concurrentRunLimit: number;
  activeRunCount: number;
  reason: string | null;
};

export type InternalObservationPipelineOrgDTO = {
  orgId: string;
  name: string;
  creditBalance: number;
  executionEnabled: boolean;
  dailyRunLimit: number;
  concurrentRunLimit: number;
};

export type InternalObservationPipelineItemDTO = {
  id: string;
  orgId: string;
  orgName: string;
  idempotencyKey: string;
  status: InternalObservationPipelineStatus;
  businessName: string;
  aliases: string[];
  category: string;
  region: string;
  city: string | null;
  address: string | null;
  websiteUrl: string | null;
  naverPlaceUrl: string | null;
  googleMapsUrl: string | null;
  service: string;
  brandModel: string | null;
  customerNeed: string | null;
  sourceLabel: string | null;
  businessId: string | null;
  questionSetId: string | null;
  runId: string | null;
  readiness: InternalObservationPipelineReadiness | null;
  errorCode: string | null;
  errorMessage: string | null;
  preparedAt: string | null;
  measurementApprovedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type InternalObservationPipelineOverviewDTO = {
  version: "0.1";
  generatedAt: string;
  organizations: InternalObservationPipelineOrgDTO[];
  items: InternalObservationPipelineItemDTO[];
};

export type InternalObservationPipelineOverviewResponse =
  | { ok: true; overview: InternalObservationPipelineOverviewDTO }
  | { ok: false; error: "FORBIDDEN" | "NOT_AVAILABLE" };

export type EnqueueInternalObservationCandidateResult =
  | { ok: true; itemId: string; idempotent: boolean }
  | { ok: false; error: "FORBIDDEN" | "INVALID_INPUT" | "INVALID_ORG" | "NOT_AVAILABLE" };

export type PrepareInternalObservationCandidateResult =
  | {
      ok: true;
      itemId: string;
      status: "ready_to_measure" | "blocked";
      businessId: string;
      questionSetId: string;
      reusedBusiness: boolean;
      reusedQuestionSet: boolean;
      readiness: InternalObservationPipelineReadiness;
    }
  | {
      ok: false;
      error: "FORBIDDEN" | "INVALID_INPUT" | "NOT_AVAILABLE";
      code?: string;
    };

export type InternalObservationPreviewQuestionDTO = {
  index: number;
  promptText: string;
  intentType: string;
  region: string | null;
  city: string | null;
};

export type InternalObservationCandidatePreviewDTO = {
  itemId: string;
  businessName: string;
  businessAction: "create" | "reuse" | "blocked";
  existingBusinessId: string | null;
  existingBusinessName: string | null;
  questionSetAction: "create" | "reuse" | "blocked";
  existingQuestionSetId: string | null;
  existingQuestionSetName: string | null;
  existingQuestionCount: number | null;
  canPrepare: boolean;
  blockerCode: string | null;
  readiness: InternalObservationPipelineReadiness;
  questions: InternalObservationPreviewQuestionDTO[];
};

export type PreviewInternalObservationCandidateResult =
  | { ok: true; preview: InternalObservationCandidatePreviewDTO }
  | {
      ok: false;
      error: "FORBIDDEN" | "INVALID_INPUT" | "NOT_AVAILABLE";
      code?: string;
    };

type LooseQuery = {
  select: (columns?: string) => LooseQuery;
  insert: (values: unknown) => LooseQuery;
  upsert: (values: unknown, options?: unknown) => LooseQuery;
  update: (values: unknown) => LooseQuery;
  eq: (column: string, value: unknown) => LooseQuery;
  in: (column: string, values: unknown[]) => LooseQuery;
  order: (column: string, options?: unknown) => LooseQuery;
  limit: (count: number) => LooseQuery;
  maybeSingle: () => Promise<{ data: unknown; error: unknown }>;
  single: () => Promise<{ data: unknown; error: unknown }>;
  then: PromiseLike<{ data: unknown; error: unknown }>["then"];
};

type LooseAdmin = {
  from: (table: string) => LooseQuery;
  rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
};

type RpcCaller = {
  rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
};

const admin = supabaseAdmin as unknown as LooseAdmin;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

const PIPELINE_STATUSES: InternalObservationPipelineStatus[] = [
  "pending",
  "preparing",
  "ready_to_measure",
  "blocked",
  "failed",
  "measuring",
  "postprocessing",
  "completed",
  "cancelled",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function str(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function nullableStr(value: unknown): string | null | undefined {
  if (value === null) return null;
  return typeof value === "string" ? value : undefined;
}

function num(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function bool(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function clean(value: string | null | undefined, max = 300): string {
  return (value ?? "").normalize("NFKC").replace(/\s+/gu, " ").trim().slice(0, max);
}

function cleanOptional(value: string | null | undefined, max = 300): string | null {
  const out = clean(value, max);
  return out || null;
}

function normalizedKeyPart(value: string | null | undefined): string {
  return clean(value, 300).toLocaleLowerCase("ko-KR");
}

function seoulDateSlug(date = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

async function isInternalAdmin(client: RpcCaller): Promise<boolean> {
  const { data, error } = await client.rpc("can_view_data_asset_admin_v01");
  return !error && data === true;
}

function parseReadiness(value: unknown): InternalObservationPipelineReadiness | null {
  if (!isRecord(value)) return null;
  const providerReady = bool(value["providerReady"]);
  const creditBalance = num(value["creditBalance"]);
  const executionEnabled = bool(value["executionEnabled"]);
  const dailyRunLimit = num(value["dailyRunLimit"]);
  const concurrentRunLimit = num(value["concurrentRunLimit"]);
  const activeRunCount = num(value["activeRunCount"]);
  const reason = nullableStr(value["reason"]);
  if (
    providerReady === null ||
    creditBalance === null ||
    executionEnabled === null ||
    dailyRunLimit === null ||
    concurrentRunLimit === null ||
    activeRunCount === null ||
    reason === undefined
  ) {
    return null;
  }
  return {
    providerReady,
    creditBalance,
    executionEnabled,
    dailyRunLimit,
    concurrentRunLimit,
    activeRunCount,
    reason,
  };
}

function parsePipelineItem(value: unknown, orgName: string): InternalObservationPipelineItemDTO | null {
  if (!isRecord(value)) return null;
  const id = str(value["id"]);
  const orgId = str(value["org_id"]);
  const idempotencyKey = str(value["idempotency_key"]);
  const status = str(value["status"]);
  const businessName = str(value["business_name"]);
  const aliasesRaw = value["aliases"];
  const category = str(value["category"]);
  const region = str(value["region"]);
  const city = nullableStr(value["city"]);
  const address = nullableStr(value["address"]);
  const websiteUrl = nullableStr(value["website_url"]);
  const naverPlaceUrl = nullableStr(value["naver_place_url"]);
  const googleMapsUrl = nullableStr(value["google_maps_url"]);
  const service = str(value["service"]);
  const brandModel = nullableStr(value["brand_model"]);
  const customerNeed = nullableStr(value["customer_need"]);
  const sourceLabel = nullableStr(value["source_label"]);
  const businessId = nullableStr(value["business_id"]);
  const questionSetId = nullableStr(value["question_set_id"]);
  const runId = nullableStr(value["run_id"]);
  const errorCode = nullableStr(value["error_code"]);
  const errorMessage = nullableStr(value["error_message"]);
  const preparedAt = nullableStr(value["prepared_at"]);
  const measurementApprovedAt = nullableStr(value["measurement_approved_at"]);
  const createdAt = str(value["created_at"]);
  const updatedAt = str(value["updated_at"]);

  if (
    !id ||
    !orgId ||
    !idempotencyKey ||
    !status ||
    !PIPELINE_STATUSES.includes(status as InternalObservationPipelineStatus) ||
    !businessName ||
    !Array.isArray(aliasesRaw) ||
    !aliasesRaw.every((item) => typeof item === "string") ||
    category === null ||
    !region ||
    city === undefined ||
    address === undefined ||
    websiteUrl === undefined ||
    naverPlaceUrl === undefined ||
    googleMapsUrl === undefined ||
    !service ||
    brandModel === undefined ||
    customerNeed === undefined ||
    sourceLabel === undefined ||
    businessId === undefined ||
    questionSetId === undefined ||
    runId === undefined ||
    errorCode === undefined ||
    errorMessage === undefined ||
    preparedAt === undefined ||
    measurementApprovedAt === undefined ||
    !createdAt ||
    !updatedAt
  ) {
    return null;
  }

  return {
    id,
    orgId,
    orgName,
    idempotencyKey,
    status: status as InternalObservationPipelineStatus,
    businessName,
    aliases: aliasesRaw as string[],
    category,
    region,
    city,
    address,
    websiteUrl,
    naverPlaceUrl,
    googleMapsUrl,
    service,
    brandModel,
    customerNeed,
    sourceLabel,
    businessId,
    questionSetId,
    runId,
    readiness: parseReadiness(value["readiness"]),
    errorCode,
    errorMessage,
    preparedAt,
    measurementApprovedAt,
    createdAt,
    updatedAt,
  };
}

async function loadEligibleInternalOrg(orgId: string) {
  const { data, error } = await admin
    .from("organizations")
    .select("id, name, measurement_data_origin")
    .eq("id", orgId)
    .eq("measurement_data_origin", "internal_observation")
    .maybeSingle();
  if (error || !isRecord(data)) return null;
  return {
    id: str(data["id"]) ?? "",
    name: str(data["name"]) ?? "",
  };
}

async function buildReadiness(orgId: string): Promise<InternalObservationPipelineReadiness> {
  const [providerRes, creditRes, settingsRes, activeRunsRes] = await Promise.all([
    admin
      .from("provider_settings")
      .select("enabled, paid_account_confirmed, terms_reviewed, automated_benchmark_approved")
      .eq("org_id", orgId)
      .eq("provider", "openai")
      .maybeSingle(),
    admin
      .from("measurement_credit_accounts")
      .select("balance")
      .eq("org_id", orgId)
      .maybeSingle(),
    admin
      .from("internal_observation_pipeline_settings")
      .select("execution_enabled, daily_run_limit, concurrent_run_limit")
      .eq("org_id", orgId)
      .maybeSingle(),
    admin
      .from("measurement_runs")
      .select("id")
      .eq("org_id", orgId)
      .eq("run_type", "audit")
      .eq("phase", "standalone")
      .in("status", ["queued", "running"]),
  ]);

  const providerRow = isRecord(providerRes.data) ? providerRes.data : {};
  const providerReady =
    providerRes.error == null &&
    providerRow["enabled"] === true &&
    providerRow["paid_account_confirmed"] === true &&
    providerRow["terms_reviewed"] === true &&
    providerRow["automated_benchmark_approved"] === true;

  const creditRow = isRecord(creditRes.data) ? creditRes.data : {};
  const creditBalance = Math.max(0, Math.trunc(num(creditRow["balance"]) ?? 0));

  const settingsRow = isRecord(settingsRes.data) ? settingsRes.data : {};
  const executionEnabled = settingsRow["execution_enabled"] === true;
  const dailyRunLimit = Math.max(1, Math.trunc(num(settingsRow["daily_run_limit"]) ?? 5));
  const concurrentRunLimit = Math.max(1, Math.trunc(num(settingsRow["concurrent_run_limit"]) ?? 1));

  const activeRunRows = Array.isArray(activeRunsRes.data) ? activeRunsRes.data : [];
  const activeRunCount = activeRunRows.length;

  let reason: string | null = null;
  if (!providerReady) reason = "PROVIDER_NOT_READY";
  else if (creditBalance < 1) reason = "NO_MEASUREMENT_CREDIT";

  return {
    providerReady,
    creditBalance,
    executionEnabled,
    dailyRunLimit,
    concurrentRunLimit,
    activeRunCount,
    reason,
  };
}

function candidateIdempotencyKey(input: {
  orgId: string;
  businessName: string;
  region: string;
  city: string | null;
  service: string;
  brandModel: string | null;
  customerNeed: string | null;
}): string {
  return [
    "v0.1",
    input.orgId.toLowerCase(),
    businessNameIdentityKey(input.businessName),
    normalizedKeyPart(input.region),
    normalizedKeyPart(input.city),
    normalizedKeyPart(input.service),
    normalizedKeyPart(input.brandModel),
    normalizedKeyPart(input.customerNeed),
  ].join("|");
}

function parseUrl(input: string | null | undefined): { ok: true; value: string | null } | { ok: false } {
  return normalizeOptionalPublicUrl(input);
}

async function previewOne(
  itemId: string,
): Promise<PreviewInternalObservationCandidateResult> {
  const { data: raw, error } = await admin
    .from("internal_observation_pipeline_items")
    .select("*")
    .eq("id", itemId)
    .maybeSingle();

  if (error || !isRecord(raw)) {
    return { ok: false, error: "NOT_AVAILABLE", code: "ITEM_NOT_FOUND" };
  }

  const orgId = str(raw["org_id"]);
  const businessName = str(raw["business_name"]);
  const category = str(raw["category"]);
  const region = str(raw["region"]);
  const city = nullableStr(raw["city"]);
  const service = str(raw["service"]);
  const brandModel = nullableStr(raw["brand_model"]);
  const customerNeed = nullableStr(raw["customer_need"]);

  if (
    !orgId ||
    !businessName ||
    category === null ||
    !region ||
    city === undefined ||
    !service ||
    brandModel === undefined ||
    customerNeed === undefined
  ) {
    return { ok: false, error: "INVALID_INPUT", code: "INVALID_ITEM" };
  }

  if (!(await loadEligibleInternalOrg(orgId))) {
    return {
      ok: false,
      error: "INVALID_INPUT",
      code: "INTERNAL_OBSERVATION_ORG_REQUIRED",
    };
  }

  const candidates = buildUnifiedDiagnosticQuestionCandidates(
    {
      location: region,
      service,
      brandModel,
      customerNeed,
    },
    businessName,
    category,
    city,
  );

  if (
    candidates.length !== 24 ||
    candidates.some((candidate) => candidate.containsBusinessName || !candidate.selected) ||
    !hasUnifiedDiagnosticIntentShape(candidates.map((candidate) => candidate.intentType))
  ) {
    return {
      ok: false,
      error: "INVALID_INPUT",
      code: "INVALID_QUESTION_CONTRACT",
    };
  }

  const questions: InternalObservationPreviewQuestionDTO[] = candidates.map(
    (candidate, index) => {
      const location = resolveQuestionLocation(candidate.promptText, region, city);
      return {
        index: index + 1,
        promptText: candidate.promptText,
        intentType: candidate.intentType,
        region: location.region,
        city: location.city,
      };
    },
  );

  const { data: businessRowsRaw, error: businessError } = await admin
    .from("businesses")
    .select("id, name, active")
    .eq("org_id", orgId)
    .eq("is_client_business", true);

  if (businessError) {
    return { ok: false, error: "NOT_AVAILABLE", code: "BUSINESS_LOOKUP_FAILED" };
  }

  const businessRows = Array.isArray(businessRowsRaw) ? businessRowsRaw : [];
  const existingBusiness =
    businessRows.find((row) => {
      if (!isRecord(row)) return false;
      const name = str(row["name"]);
      return !!name && businessNameIdentityKey(name) === businessNameIdentityKey(businessName);
    }) ?? null;

  const existingBusinessId =
    existingBusiness && isRecord(existingBusiness) ? str(existingBusiness["id"]) : null;
  const existingBusinessName =
    existingBusiness && isRecord(existingBusiness) ? str(existingBusiness["name"]) : null;
  const existingBusinessActive =
    existingBusiness && isRecord(existingBusiness) ? existingBusiness["active"] === true : null;

  let businessAction: InternalObservationCandidatePreviewDTO["businessAction"] =
    existingBusinessId ? "reuse" : "create";
  let questionSetAction: InternalObservationCandidatePreviewDTO["questionSetAction"] = "create";
  let existingQuestionSetId: string | null = null;
  let existingQuestionSetName: string | null = null;
  let existingQuestionCount: number | null = null;
  let blockerCode: string | null = null;

  if (existingBusinessId && existingBusinessActive === false) {
    businessAction = "blocked";
    questionSetAction = "blocked";
    blockerCode = "EXISTING_BUSINESS_INACTIVE";
  }

  if (existingBusinessId && !blockerCode) {
    const { data: setRowsRaw, error: setError } = await admin
      .from("question_sets")
      .select("id, name, active, created_at")
      .eq("org_id", orgId)
      .eq("business_id", existingBusinessId)
      .eq("active", true)
      .order("created_at", { ascending: false });

    if (setError) {
      return { ok: false, error: "NOT_AVAILABLE", code: "QUESTION_SET_LOOKUP_FAILED" };
    }

    const setRows = Array.isArray(setRowsRaw) ? setRowsRaw : [];
    const unifiedSet =
      setRows.find((row) => {
        if (!isRecord(row)) return false;
        const name = str(row["name"]);
        return !!name && name.startsWith(UNIFIED_DIAGNOSTIC_SET_PREFIX);
      }) ?? null;

    if (unifiedSet && isRecord(unifiedSet)) {
      existingQuestionSetId = str(unifiedSet["id"]);
      existingQuestionSetName = str(unifiedSet["name"]);

      if (existingQuestionSetId) {
        const { data: questionRowsRaw, error: questionError } = await admin
          .from("questions")
          .select("intent_type, active")
          .eq("question_set_id", existingQuestionSetId)
          .eq("active", true);

        if (questionError) {
          return { ok: false, error: "NOT_AVAILABLE", code: "QUESTION_LOOKUP_FAILED" };
        }

        const questionRows = Array.isArray(questionRowsRaw) ? questionRowsRaw : [];
        const intentTypes = questionRows
          .map((row) => (isRecord(row) ? str(row["intent_type"]) : null))
          .filter((intent): intent is string => !!intent);

        existingQuestionCount = intentTypes.length;
        if (
          existingQuestionCount === 24 &&
          hasUnifiedDiagnosticIntentShape(intentTypes)
        ) {
          questionSetAction = "reuse";
        } else {
          questionSetAction = "blocked";
          blockerCode = "EXISTING_UNIFIED_SET_INVALID";
        }
      }
    }
  }

  const readiness = await buildReadiness(orgId);
  return {
    ok: true,
    preview: {
      itemId,
      businessName,
      businessAction,
      existingBusinessId,
      existingBusinessName,
      questionSetAction,
      existingQuestionSetId,
      existingQuestionSetName,
      existingQuestionCount,
      canPrepare: blockerCode === null,
      blockerCode,
      readiness,
      questions,
    },
  };
}

async function prepareOne(
  itemId: string,
  actorUserId: string,
): Promise<PrepareInternalObservationCandidateResult> {
  const { data: claimedRaw, error: claimError } = await admin
    .from("internal_observation_pipeline_items")
    .update({
      status: "preparing",
      error_code: null,
      error_message: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", itemId)
    .in("status", ["pending", "blocked", "failed"])
    .select("*")
    .maybeSingle();

  if (claimError || !isRecord(claimedRaw)) {
    return { ok: false, error: "NOT_AVAILABLE", code: "CLAIM_FAILED" };
  }

  const orgId = str(claimedRaw["org_id"]);
  const businessName = str(claimedRaw["business_name"]);
  const category = str(claimedRaw["category"]);
  const region = str(claimedRaw["region"]);
  const city = nullableStr(claimedRaw["city"]);
  const service = str(claimedRaw["service"]);
  const brandModel = nullableStr(claimedRaw["brand_model"]);
  const customerNeed = nullableStr(claimedRaw["customer_need"]);

  if (
    !orgId ||
    !businessName ||
    category === null ||
    !region ||
    city === undefined ||
    !service ||
    brandModel === undefined ||
    customerNeed === undefined
  ) {
    await admin
      .from("internal_observation_pipeline_items")
      .update({
        status: "failed",
        error_code: "INVALID_ITEM",
        error_message: "후보 입력값을 읽을 수 없습니다.",
        updated_at: new Date().toISOString(),
      })
      .eq("id", itemId);
    return { ok: false, error: "INVALID_INPUT", code: "INVALID_ITEM" };
  }

  const eligibleOrg = await loadEligibleInternalOrg(orgId);
  if (!eligibleOrg) {
    await admin
      .from("internal_observation_pipeline_items")
      .update({
        status: "blocked",
        error_code: "INTERNAL_OBSERVATION_ORG_REQUIRED",
        error_message: "내부 관찰 조직만 사용할 수 있습니다.",
        updated_at: new Date().toISOString(),
      })
      .eq("id", itemId);
    return { ok: false, error: "INVALID_INPUT", code: "INTERNAL_OBSERVATION_ORG_REQUIRED" };
  }

  const candidates = buildUnifiedDiagnosticQuestionCandidates(
    {
      location: region,
      service,
      brandModel,
      customerNeed,
    },
    businessName,
    category,
    city,
  );

  if (
    candidates.length !== 24 ||
    candidates.some((candidate) => candidate.containsBusinessName || !candidate.selected) ||
    !hasUnifiedDiagnosticIntentShape(candidates.map((candidate) => candidate.intentType))
  ) {
    await admin
      .from("internal_observation_pipeline_items")
      .update({
        status: "blocked",
        error_code: "INVALID_QUESTION_CONTRACT",
        error_message: "통합 AI 진단 24문항 계약을 완성하지 못했습니다.",
        updated_at: new Date().toISOString(),
      })
      .eq("id", itemId);
    return { ok: false, error: "INVALID_INPUT", code: "INVALID_QUESTION_CONTRACT" };
  }

  const questionRows = candidates.map((candidate) => {
    const location = resolveQuestionLocation(candidate.promptText, region, city);
    return {
      prompt_text: candidate.promptText,
      intent_type: candidate.intentType,
      region: location.region,
      city: location.city,
    };
  });

  const { data: rpcData, error: rpcError } = await admin.rpc(
    "prepare_internal_observation_candidate_v01",
    {
      p_candidate_id: itemId,
      p_questions: questionRows,
      p_question_set_name: `${UNIFIED_DIAGNOSTIC_SET_PREFIX}${businessName} · ${seoulDateSlug()}`,
      p_actor_user_id: actorUserId,
    },
  );

  if (rpcError) {
    const message = String((rpcError as { message?: unknown }).message ?? "");
    const knownCode = [
      "EXISTING_BUSINESS_INACTIVE",
      "EXISTING_UNIFIED_SET_INVALID",
      "INVALID_QUESTION_PAYLOAD",
      "INVALID_QUESTION_CONTRACT",
      "INTERNAL_OBSERVATION_ORG_REQUIRED",
    ].find((code) => message.includes(code));

    await admin
      .from("internal_observation_pipeline_items")
      .update({
        status: knownCode ? "blocked" : "failed",
        error_code: knownCode ?? "PREPARE_FAILED",
        error_message: knownCode
          ? "기존 데이터 상태를 자동으로 변경하지 않고 중단했습니다."
          : "내부 후보 준비 중 오류가 발생했습니다.",
        updated_at: new Date().toISOString(),
      })
      .eq("id", itemId);

    return {
      ok: false,
      error: knownCode ? "INVALID_INPUT" : "NOT_AVAILABLE",
      code: knownCode ?? "PREPARE_FAILED",
    };
  }

  const row = Array.isArray(rpcData) ? rpcData[0] : rpcData;
  if (!isRecord(row)) {
    await admin
      .from("internal_observation_pipeline_items")
      .update({
        status: "failed",
        error_code: "PREPARE_RESPONSE_INVALID",
        error_message: "준비 결과를 확인할 수 없습니다.",
        updated_at: new Date().toISOString(),
      })
      .eq("id", itemId);
    return { ok: false, error: "NOT_AVAILABLE", code: "PREPARE_RESPONSE_INVALID" };
  }

  const businessId = str(row["business_id"]);
  const questionSetId = str(row["question_set_id"]);
  const reusedBusiness = row["reused_business"] === true;
  const reusedQuestionSet = row["reused_question_set"] === true;
  if (!businessId || !questionSetId) {
    return { ok: false, error: "NOT_AVAILABLE", code: "PREPARE_RESPONSE_INVALID" };
  }

  const readiness = await buildReadiness(orgId);
  const ready = readiness.reason === null;

  await admin
    .from("internal_observation_pipeline_items")
    .update({
      status: ready ? "ready_to_measure" : "blocked",
      readiness,
      error_code: readiness.reason,
      error_message:
        readiness.reason === "NO_MEASUREMENT_CREDIT"
          ? "내부 관찰 조직의 측정권이 없습니다."
          : readiness.reason === "PROVIDER_NOT_READY"
            ? "OpenAI 자동 측정 준비 설정을 확인해 주세요."
            : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", itemId);

  return {
    ok: true,
    itemId,
    status: ready ? "ready_to_measure" : "blocked",
    businessId,
    questionSetId,
    reusedBusiness,
    reusedQuestionSet,
    readiness,
  };
}

export const getInternalObservationPipelineOverview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<InternalObservationPipelineOverviewResponse> => {
    const client = context.supabase as unknown as RpcCaller;
    if (!(await isInternalAdmin(client))) return { ok: false, error: "FORBIDDEN" };

    // v0.3: each internal overview refresh performs bounded terminal reconciliation.
    // It never creates a new run or retries a failed measurement.
    try {
      await reconcileInternalObservationPipelineItems({ limit: 20 });
    } catch {
      // Overview remains available even when reconciliation needs a later retry.
    }

    const [orgRes, itemRes] = await Promise.all([
      admin
        .from("organizations")
        .select("id, name")
        .eq("measurement_data_origin", "internal_observation")
        .order("created_at", { ascending: true }),
      admin
        .from("internal_observation_pipeline_items")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100),
    ]);

    if (orgRes.error || itemRes.error) return { ok: false, error: "NOT_AVAILABLE" };

    const orgRows = Array.isArray(orgRes.data) ? orgRes.data : [];
    const itemRows = Array.isArray(itemRes.data) ? itemRes.data : [];

    const organizations: InternalObservationPipelineOrgDTO[] = [];
    const orgNameById = new Map<string, string>();

    for (const raw of orgRows) {
      if (!isRecord(raw)) continue;
      const orgId = str(raw["id"]);
      const name = str(raw["name"]);
      if (!orgId || !name) continue;
      orgNameById.set(orgId, name);

      const readiness = await buildReadiness(orgId);
      organizations.push({
        orgId,
        name,
        creditBalance: readiness.creditBalance,
        executionEnabled: readiness.executionEnabled,
        dailyRunLimit: readiness.dailyRunLimit,
        concurrentRunLimit: readiness.concurrentRunLimit,
      });
    }

    const items: InternalObservationPipelineItemDTO[] = [];
    for (const raw of itemRows) {
      if (!isRecord(raw)) continue;
      const orgId = str(raw["org_id"]);
      if (!orgId) continue;
      const parsed = parsePipelineItem(raw, orgNameById.get(orgId) ?? "내부 관찰 조직");
      if (parsed) items.push(parsed);
    }

    return {
      ok: true,
      overview: {
        version: "0.1",
        generatedAt: new Date().toISOString(),
        organizations,
        items,
      },
    };
  });

export const enqueueInternalObservationCandidate = createServerFn({ method: "POST" })
  .inputValidator(
    (input: {
      orgId: string;
      businessName: string;
      aliases?: string[];
      category: string;
      region: string;
      city?: string | null;
      address?: string | null;
      websiteUrl?: string | null;
      naverPlaceUrl?: string | null;
      googleMapsUrl?: string | null;
      service: string;
      brandModel?: string | null;
      customerNeed?: string | null;
      sourceLabel?: string | null;
    }) => input,
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }): Promise<EnqueueInternalObservationCandidateResult> => {
    const client = context.supabase as unknown as RpcCaller;
    if (!(await isInternalAdmin(client))) return { ok: false, error: "FORBIDDEN" };

    const orgId = clean(data.orgId, 64).toLowerCase();
    const businessName = normalizeBusinessName(data.businessName);
    const aliases = normalizeAliasList(data.aliases ?? []);
    const category = clean(data.category, 200);
    const region = clean(data.region, 120);
    const city = cleanOptional(data.city, 120);
    const address = cleanOptional(data.address, 300);
    const service = clean(data.service, 80);
    const brandModel = cleanOptional(data.brandModel, 80);
    const customerNeed = cleanOptional(data.customerNeed, 80);
    const sourceLabel = cleanOptional(data.sourceLabel, 200);

    if (
      !UUID_RE.test(orgId) ||
      !businessName ||
      !category ||
      !region ||
      !service ||
      businessName.length > 200
    ) {
      return { ok: false, error: "INVALID_INPUT" };
    }

    const website = parseUrl(data.websiteUrl);
    const naver = parseUrl(data.naverPlaceUrl);
    const google = parseUrl(data.googleMapsUrl);
    if (!website.ok || !naver.ok || !google.ok) {
      return { ok: false, error: "INVALID_INPUT" };
    }

    if (!(await loadEligibleInternalOrg(orgId))) return { ok: false, error: "INVALID_ORG" };

    const idempotencyKey = candidateIdempotencyKey({
      orgId,
      businessName,
      region,
      city,
      service,
      brandModel,
      customerNeed,
    });

    await admin
      .from("internal_observation_pipeline_settings")
      .upsert({ org_id: orgId }, { onConflict: "org_id", ignoreDuplicates: true });

    const { data: existingRaw } = await admin
      .from("internal_observation_pipeline_items")
      .select("id")
      .eq("org_id", orgId)
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();

    if (isRecord(existingRaw) && str(existingRaw["id"])) {
      return { ok: true, itemId: str(existingRaw["id"])!, idempotent: true };
    }

    const { data: insertedRaw, error } = await admin
      .from("internal_observation_pipeline_items")
      .insert({
        org_id: orgId,
        idempotency_key: idempotencyKey,
        status: "pending",
        business_name: businessName,
        aliases,
        category,
        region,
        city,
        address,
        website_url: website.value,
        naver_place_url: naver.value,
        google_maps_url: google.value,
        service,
        brand_model: brandModel,
        customer_need: customerNeed,
        source_label: sourceLabel,
        created_by: context.userId,
      })
      .select("id")
      .single();

    if (error || !isRecord(insertedRaw) || !str(insertedRaw["id"])) {
      const { data: racedRaw } = await admin
        .from("internal_observation_pipeline_items")
        .select("id")
        .eq("org_id", orgId)
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();
      if (isRecord(racedRaw) && str(racedRaw["id"])) {
        return { ok: true, itemId: str(racedRaw["id"])!, idempotent: true };
      }
      return { ok: false, error: "NOT_AVAILABLE" };
    }

    return { ok: true, itemId: str(insertedRaw["id"])!, idempotent: false };
  });

export const previewInternalObservationCandidate = createServerFn({ method: "POST" })
  .inputValidator((input: { itemId: string }) => {
    if (!input || typeof input.itemId !== "string" || !UUID_RE.test(input.itemId.trim())) {
      throw new Error("INVALID_INPUT");
    }
    return { itemId: input.itemId.trim().toLowerCase() };
  })
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }): Promise<PreviewInternalObservationCandidateResult> => {
    const client = context.supabase as unknown as RpcCaller;
    if (!(await isInternalAdmin(client))) return { ok: false, error: "FORBIDDEN" };
    return previewOne(data.itemId);
  });

export const prepareInternalObservationCandidate = createServerFn({ method: "POST" })
  .inputValidator((input: { itemId: string }) => {
    if (!input || typeof input.itemId !== "string" || !UUID_RE.test(input.itemId.trim())) {
      throw new Error("INVALID_INPUT");
    }
    return { itemId: input.itemId.trim().toLowerCase() };
  })
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }): Promise<PrepareInternalObservationCandidateResult> => {
    const client = context.supabase as unknown as RpcCaller;
    if (!(await isInternalAdmin(client))) return { ok: false, error: "FORBIDDEN" };
    return prepareOne(data.itemId, context.userId);
  });
