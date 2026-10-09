import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type InternalObservationDiscoveryCadence = "daily" | "weekly";

export type InternalObservationDiscoveryScheduleDTO = {
  id: string;
  orgId: string;
  name: string;
  enabled: boolean;
  category: string;
  service: string;
  region: string;
  city: string | null;
  brandModel: string | null;
  desiredCount: number;
  cadence: InternalObservationDiscoveryCadence;
  runHourKst: number;
  weekdayIso: number | null;
  actorUserId: string;
  lastStartedAt: string | null;
  lastCompletedAt: string | null;
  lastStatus: "completed" | "failed" | null;
  lastErrorCode: string | null;
  createdAt: string;
  updatedAt: string;
};

export type InternalObservationDiscoveryBatchDTO = {
  id: string;
  scheduleId: string | null;
  triggerSource: "manual" | "scheduled";
  status: "running" | "completed" | "failed";
  candidateCount: number | null;
  newCount: number | null;
  changedCount: number | null;
  unchangedCount: number | null;
  publicSourceCount: number | null;
  provider: string | null;
  model: string | null;
  errorCode: string | null;
  startedAt: string;
  completedAt: string | null;
};

export type InternalObservationDiscoveryBatchChangeDTO = {
  batchId: string;
  reviewCandidateId: string | null;
  classification: "new" | "changed";
  businessName: string;
};

export type InternalObservationDiscoveryRecurringOverviewDTO = {
  version: "0.9.4";
  generatedAt: string;
  globalCron: {
    jobExists: boolean;
    active: boolean;
    schedule: string | null;
  };
  schedules: InternalObservationDiscoveryScheduleDTO[];
  recentBatches: InternalObservationDiscoveryBatchDTO[];
  recentChanges: InternalObservationDiscoveryBatchChangeDTO[];
};

export type GetInternalObservationDiscoveryRecurringOverviewResult =
  | { ok: true; overview: InternalObservationDiscoveryRecurringOverviewDTO }
  | { ok: false; error: "FORBIDDEN" | "INVALID_INPUT" | "NOT_AVAILABLE" };

export type SaveInternalObservationDiscoveryScheduleResult =
  | {
      ok: true;
      schedule: InternalObservationDiscoveryScheduleDTO;
      idempotent: boolean;
    }
  | {
      ok: false;
      error: "FORBIDDEN" | "INVALID_INPUT" | "NOT_AVAILABLE";
    };

export type RunInternalObservationDiscoveryScheduleNowResult =
  | {
      ok: true;
      batchId: string;
      candidateCount: number;
      newCount: number;
      changedCount: number;
      unchangedCount: number;
      publicSourceCount: number;
    }
  | {
      ok: false;
      error:
        | "FORBIDDEN"
        | "INVALID_INPUT"
        | "NOT_AVAILABLE"
        | "DISCOVERY_FAILED";
    };

type LooseQuery = {
  select: (columns?: string) => LooseQuery;
  insert: (values: unknown) => LooseQuery;
  update: (values: unknown) => LooseQuery;
  eq: (column: string, value: unknown) => LooseQuery;
  order: (column: string, options?: unknown) => LooseQuery;
  limit: (count: number) => LooseQuery;
  maybeSingle: () => Promise<{ data: unknown; error: unknown }>;
  single: () => Promise<{ data: unknown; error: unknown }>;
  then: PromiseLike<{ data: unknown; error: unknown }>["then"];
};

type LooseAdmin = {
  from: (table: string) => LooseQuery;
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: unknown }>;
};

type RpcCaller = {
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: unknown }>;
  functions: {
    invoke: (
      fn: string,
      options?: { body?: unknown },
    ) => PromiseLike<{ data: unknown; error: unknown }>;
  };
};

const admin = supabaseAdmin as unknown as LooseAdmin;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

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

function clean(value: string | null | undefined, max = 300): string {
  return (value ?? "")
    .normalize("NFKC")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, max);
}

function cleanOptional(
  value: string | null | undefined,
  max = 300,
): string | null {
  const out = clean(value, max);
  return out || null;
}

function num(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function isInternalAdmin(client: RpcCaller): Promise<boolean> {
  const { data, error } = await client.rpc("can_view_data_asset_admin_v01");
  return !error && data === true;
}

async function canOperateOrg(orgId: string, userId: string): Promise<boolean> {
  const [orgRes, memberRes] = await Promise.all([
    admin
      .from("organizations")
      .select("id,measurement_data_origin")
      .eq("id", orgId)
      .eq("measurement_data_origin", "internal_observation")
      .maybeSingle(),
    admin
      .from("organization_members")
      .select("role")
      .eq("org_id", orgId)
      .eq("user_id", userId)
      .maybeSingle(),
  ]);

  if (
    orgRes.error ||
    memberRes.error ||
    !isRecord(orgRes.data) ||
    !isRecord(memberRes.data)
  ) {
    return false;
  }

  const role = str(memberRes.data["role"]);
  return role === "owner" || role === "admin" || role === "analyst";
}

function parseSchedule(value: unknown): InternalObservationDiscoveryScheduleDTO | null {
  if (!isRecord(value)) return null;
  const id = str(value["id"]);
  const orgId = str(value["org_id"]);
  const name = str(value["name"]);
  const enabled = value["enabled"];
  const category = str(value["category"]);
  const service = str(value["service"]);
  const region = str(value["region"]);
  const city = nullableStr(value["city"]);
  const brandModel = nullableStr(value["brand_model"]);
  const desiredCount = num(value["desired_count"]);
  const cadence = str(value["cadence"]);
  const runHourKst = num(value["run_hour_kst"]);
  const weekdayRaw = value["weekday_iso"];
  const weekdayIso =
    weekdayRaw === null ? null : num(weekdayRaw);
  const actorUserId = str(value["actor_user_id"]);
  const lastStartedAt = nullableStr(value["last_started_at"]);
  const lastCompletedAt = nullableStr(value["last_completed_at"]);
  const lastStatus = nullableStr(value["last_status"]);
  const lastErrorCode = nullableStr(value["last_error_code"]);
  const createdAt = str(value["created_at"]);
  const updatedAt = str(value["updated_at"]);

  if (
    !id ||
    !orgId ||
    !name ||
    typeof enabled !== "boolean" ||
    !category ||
    !service ||
    !region ||
    city === undefined ||
    brandModel === undefined ||
    desiredCount === null ||
    !Number.isInteger(desiredCount) ||
    desiredCount < 1 ||
    desiredCount > 8 ||
    (cadence !== "daily" && cadence !== "weekly") ||
    runHourKst === null ||
    !Number.isInteger(runHourKst) ||
    runHourKst < 0 ||
    runHourKst > 23 ||
    (weekdayIso !== null &&
      (!Number.isInteger(weekdayIso) || weekdayIso < 1 || weekdayIso > 7)) ||
    !actorUserId ||
    lastStartedAt === undefined ||
    lastCompletedAt === undefined ||
    (lastStatus !== null &&
      lastStatus !== "completed" &&
      lastStatus !== "failed") ||
    lastErrorCode === undefined ||
    !createdAt ||
    !updatedAt
  ) {
    return null;
  }

  return {
    id,
    orgId,
    name,
    enabled,
    category,
    service,
    region,
    city,
    brandModel,
    desiredCount,
    cadence,
    runHourKst,
    weekdayIso,
    actorUserId,
    lastStartedAt,
    lastCompletedAt,
    lastStatus,
    lastErrorCode,
    createdAt,
    updatedAt,
  };
}

function parseBatch(value: unknown): InternalObservationDiscoveryBatchDTO | null {
  if (!isRecord(value)) return null;
  const id = str(value["id"]);
  const scheduleId = nullableStr(value["schedule_id"]);
  const triggerSource = str(value["trigger_source"]);
  const status = str(value["status"]);
  const candidateCount =
    value["candidate_count"] === null ? null : num(value["candidate_count"]);
  const newCount = value["new_count"] === null ? null : num(value["new_count"]);
  const changedCount =
    value["changed_count"] === null ? null : num(value["changed_count"]);
  const unchangedCount =
    value["unchanged_count"] === null ? null : num(value["unchanged_count"]);
  const publicSourceCount =
    value["public_source_count"] === null
      ? null
      : num(value["public_source_count"]);
  const provider = nullableStr(value["provider"]);
  const model = nullableStr(value["model"]);
  const errorCode = nullableStr(value["error_code"]);
  const startedAt = str(value["started_at"]);
  const completedAt = nullableStr(value["completed_at"]);

  if (
    !id ||
    scheduleId === undefined ||
    (triggerSource !== "manual" && triggerSource !== "scheduled") ||
    (status !== "running" && status !== "completed" && status !== "failed") ||
    candidateCount === undefined ||
    newCount === undefined ||
    changedCount === undefined ||
    unchangedCount === undefined ||
    publicSourceCount === undefined ||
    provider === undefined ||
    model === undefined ||
    errorCode === undefined ||
    !startedAt ||
    completedAt === undefined
  ) {
    return null;
  }

  return {
    id,
    scheduleId,
    triggerSource,
    status,
    candidateCount,
    newCount,
    changedCount,
    unchangedCount,
    publicSourceCount,
    provider,
    model,
    errorCode,
    startedAt,
    completedAt,
  };
}

function parseChange(value: unknown): InternalObservationDiscoveryBatchChangeDTO | null {
  if (!isRecord(value)) return null;
  const batchId = str(value["batch_id"]);
  const reviewCandidateId = nullableStr(value["review_candidate_id"]);
  const classification = str(value["classification"]);
  const businessName = str(value["business_name"]);
  if (
    !batchId ||
    reviewCandidateId === undefined ||
    (classification !== "new" && classification !== "changed") ||
    !businessName
  ) {
    return null;
  }
  return {
    batchId,
    reviewCandidateId,
    classification,
    businessName,
  };
}

const SCHEDULE_SELECT = [
  "id",
  "org_id",
  "name",
  "enabled",
  "category",
  "service",
  "region",
  "city",
  "brand_model",
  "desired_count",
  "cadence",
  "run_hour_kst",
  "weekday_iso",
  "actor_user_id",
  "last_started_at",
  "last_completed_at",
  "last_status",
  "last_error_code",
  "created_at",
  "updated_at",
].join(",");

const BATCH_SELECT = [
  "id",
  "schedule_id",
  "trigger_source",
  "status",
  "candidate_count",
  "new_count",
  "changed_count",
  "unchanged_count",
  "public_source_count",
  "provider",
  "model",
  "error_code",
  "started_at",
  "completed_at",
].join(",");

export const getInternalObservationDiscoveryRecurringOverview = createServerFn({
  method: "POST",
})
  .inputValidator((input: { orgId: string }) => {
    const orgId = clean(input?.orgId, 64).toLowerCase();
    if (!UUID_RE.test(orgId)) throw new Error("INVALID_INPUT");
    return { orgId };
  })
  .middleware([requireSupabaseAuth])
  .handler(
    async ({
      data,
      context,
    }): Promise<GetInternalObservationDiscoveryRecurringOverviewResult> => {
      const client = context.supabase as unknown as RpcCaller;
      if (
        !(await isInternalAdmin(client)) ||
        !(await canOperateOrg(data.orgId, context.userId))
      ) {
        return { ok: false, error: "FORBIDDEN" };
      }

      const [schedulesRes, batchesRes, cronRes] = await Promise.all([
        admin
          .from("internal_observation_discovery_schedules")
          .select(SCHEDULE_SELECT)
          .eq("org_id", data.orgId)
          .order("created_at", { ascending: false })
          .limit(100),
        admin
          .from("internal_observation_discovery_batches")
          .select(BATCH_SELECT)
          .eq("org_id", data.orgId)
          .order("started_at", { ascending: false })
          .limit(20),
        admin.rpc("get_internal_observation_discovery_cron_state_v094"),
      ]);

      if (schedulesRes.error || batchesRes.error || cronRes.error) {
        return { ok: false, error: "NOT_AVAILABLE" };
      }

      const schedulesRaw = Array.isArray(schedulesRes.data)
        ? schedulesRes.data
        : [];
      const batchesRaw = Array.isArray(batchesRes.data)
        ? batchesRes.data
        : [];

      const schedules = schedulesRaw.map(parseSchedule);
      const batches = batchesRaw.map(parseBatch);
      if (
        schedules.some((item) => item === null) ||
        batches.some((item) => item === null)
      ) {
        return { ok: false, error: "NOT_AVAILABLE" };
      }

      const batchIds = (batches as InternalObservationDiscoveryBatchDTO[])
        .slice(0, 10)
        .map((batch) => batch.id);

      let recentChanges: InternalObservationDiscoveryBatchChangeDTO[] = [];
      if (batchIds.length > 0) {
        const { data: changesRaw, error: changesError } = await admin
          .from("internal_observation_discovery_batch_items")
          .select("batch_id,review_candidate_id,classification,business_name")
          .eq("classification", "new")
          .limit(100);

        const { data: changedRaw, error: changedError } = await admin
          .from("internal_observation_discovery_batch_items")
          .select("batch_id,review_candidate_id,classification,business_name")
          .eq("classification", "changed")
          .limit(100);

        if (changesError || changedError) {
          return { ok: false, error: "NOT_AVAILABLE" };
        }

        const combined = [
          ...(Array.isArray(changesRaw) ? changesRaw : []),
          ...(Array.isArray(changedRaw) ? changedRaw : []),
        ].filter(
          (row) =>
            isRecord(row) &&
            batchIds.includes(str(row["batch_id"]) ?? ""),
        );
        const parsedChanges = combined.map(parseChange);
        if (parsedChanges.some((item) => item === null)) {
          return { ok: false, error: "NOT_AVAILABLE" };
        }
        recentChanges =
          parsedChanges as InternalObservationDiscoveryBatchChangeDTO[];
      }

      const cron = isRecord(cronRes.data) ? cronRes.data : {};
      const jobExists = cron["job_exists"] === true;
      const active = cron["active"] === true;
      const schedule = nullableStr(cron["schedule"]);
      if (schedule === undefined) {
        return { ok: false, error: "NOT_AVAILABLE" };
      }

      return {
        ok: true,
        overview: {
          version: "0.9.4",
          generatedAt: new Date().toISOString(),
          globalCron: {
            jobExists,
            active,
            schedule,
          },
          schedules:
            schedules as InternalObservationDiscoveryScheduleDTO[],
          recentBatches:
            batches as InternalObservationDiscoveryBatchDTO[],
          recentChanges,
        },
      };
    },
  );

export const saveInternalObservationDiscoverySchedule = createServerFn({
  method: "POST",
})
  .inputValidator(
    (input: {
      orgId: string;
      name: string;
      category: string;
      service: string;
      region: string;
      city?: string | null;
      brandModel?: string | null;
      desiredCount: number;
      cadence: InternalObservationDiscoveryCadence;
      runHourKst: number;
      weekdayIso?: number | null;
    }) => {
      const orgId = clean(input?.orgId, 64).toLowerCase();
      const name = clean(input?.name, 140);
      const category = clean(input?.category, 100);
      const service = clean(input?.service, 100);
      const region = clean(input?.region, 100);
      const city = cleanOptional(input?.city, 100);
      const brandModel = cleanOptional(input?.brandModel, 200);
      const desiredCount = Number(input?.desiredCount);
      const cadence = input?.cadence;
      const runHourKst = Number(input?.runHourKst);
      const weekdayIso =
        input?.weekdayIso === null || input?.weekdayIso === undefined
          ? null
          : Number(input.weekdayIso);

      if (
        !UUID_RE.test(orgId) ||
        !name ||
        !category ||
        !service ||
        !region ||
        !Number.isInteger(desiredCount) ||
        desiredCount < 1 ||
        desiredCount > 8 ||
        (cadence !== "daily" && cadence !== "weekly") ||
        !Number.isInteger(runHourKst) ||
        runHourKst < 0 ||
        runHourKst > 23 ||
        (cadence === "daily" && weekdayIso !== null) ||
        (cadence === "weekly" &&
          (weekdayIso === null ||
            !Number.isInteger(weekdayIso) ||
            weekdayIso < 1 ||
            weekdayIso > 7))
      ) {
        throw new Error("INVALID_INPUT");
      }

      return {
        orgId,
        name,
        category,
        service,
        region,
        city,
        brandModel,
        desiredCount,
        cadence,
        runHourKst,
        weekdayIso,
      };
    },
  )
  .middleware([requireSupabaseAuth])
  .handler(
    async ({
      data,
      context,
    }): Promise<SaveInternalObservationDiscoveryScheduleResult> => {
      const client = context.supabase as unknown as RpcCaller;
      if (
        !(await isInternalAdmin(client)) ||
        !(await canOperateOrg(data.orgId, context.userId))
      ) {
        return { ok: false, error: "FORBIDDEN" };
      }

      const fingerprint = await sha256(
        JSON.stringify({
          orgId: data.orgId,
          category: data.category,
          service: data.service,
          region: data.region,
          city: data.city,
          brandModel: data.brandModel,
          desiredCount: data.desiredCount,
          cadence: data.cadence,
          runHourKst: data.runHourKst,
          weekdayIso: data.weekdayIso,
        }),
      );

      const { data: existingRaw, error: existingError } = await admin
        .from("internal_observation_discovery_schedules")
        .select(SCHEDULE_SELECT)
        .eq("org_id", data.orgId)
        .eq("query_fingerprint", fingerprint)
        .maybeSingle();

      if (existingError) return { ok: false, error: "NOT_AVAILABLE" };

      let rowRaw: unknown;
      let idempotent = false;

      if (isRecord(existingRaw)) {
        idempotent = true;
        const { data: updatedRaw, error: updateError } = await admin
          .from("internal_observation_discovery_schedules")
          .update({
            name: data.name,
            actor_user_id: context.userId,
            updated_by: context.userId,
          })
          .eq("id", str(existingRaw["id"]) ?? "")
          .eq("org_id", data.orgId)
          .select(SCHEDULE_SELECT)
          .single();
        if (updateError) return { ok: false, error: "NOT_AVAILABLE" };
        rowRaw = updatedRaw;
      } else {
        const { data: insertedRaw, error: insertError } = await admin
          .from("internal_observation_discovery_schedules")
          .insert({
            org_id: data.orgId,
            name: data.name,
            enabled: false,
            category: data.category,
            service: data.service,
            region: data.region,
            city: data.city,
            brand_model: data.brandModel,
            desired_count: data.desiredCount,
            cadence: data.cadence,
            run_hour_kst: data.runHourKst,
            weekday_iso: data.weekdayIso,
            query_fingerprint: fingerprint,
            actor_user_id: context.userId,
            created_by: context.userId,
            updated_by: context.userId,
          })
          .select(SCHEDULE_SELECT)
          .single();
        if (insertError) return { ok: false, error: "NOT_AVAILABLE" };
        rowRaw = insertedRaw;
      }

      const schedule = parseSchedule(rowRaw);
      if (!schedule) return { ok: false, error: "NOT_AVAILABLE" };

      await admin.from("system_events").insert({
        org_id: data.orgId,
        run_id: null,
        event_type: idempotent
          ? "internal_discovery_schedule_refreshed"
          : "internal_discovery_schedule_created",
        severity: "info",
        message: idempotent
          ? "Recurring discovery profile was refreshed while global automation remained unchanged."
          : "Recurring discovery profile was created disabled by default.",
        metadata: {
          discovery_version: "0.9.4",
          schedule_id: schedule.id,
          actor_user_id: context.userId,
          enabled: schedule.enabled,
          global_cron_changed: false,
          auto_approved: false,
          auto_promoted: false,
          measurement_side_effects: false,
        },
      });

      return { ok: true, schedule, idempotent };
    },
  );

export const runInternalObservationDiscoveryScheduleNow = createServerFn({
  method: "POST",
})
  .inputValidator((input: { orgId: string; scheduleId: string }) => {
    const orgId = clean(input?.orgId, 64).toLowerCase();
    const scheduleId = clean(input?.scheduleId, 64).toLowerCase();
    if (!UUID_RE.test(orgId) || !UUID_RE.test(scheduleId)) {
      throw new Error("INVALID_INPUT");
    }
    return { orgId, scheduleId };
  })
  .middleware([requireSupabaseAuth])
  .handler(
    async ({
      data,
      context,
    }): Promise<RunInternalObservationDiscoveryScheduleNowResult> => {
      const client = context.supabase as unknown as RpcCaller;
      if (
        !(await isInternalAdmin(client)) ||
        !(await canOperateOrg(data.orgId, context.userId))
      ) {
        return { ok: false, error: "FORBIDDEN" };
      }

      const { data: scheduleRaw, error: scheduleError } = await admin
        .from("internal_observation_discovery_schedules")
        .select("id,org_id")
        .eq("id", data.scheduleId)
        .eq("org_id", data.orgId)
        .maybeSingle();

      if (scheduleError || !isRecord(scheduleRaw)) {
        return { ok: false, error: "NOT_AVAILABLE" };
      }

      const { data: response, error } = await client.functions.invoke(
        "internal-observation-discovery-batch",
        { body: { scheduleId: data.scheduleId } },
      );

      if (error || !isRecord(response) || response["ok"] !== true) {
        return { ok: false, error: "DISCOVERY_FAILED" };
      }

      const batchId = str(response["batchId"]);
      const candidateCount = num(response["candidateCount"]);
      const newCount = num(response["newCount"]);
      const changedCount = num(response["changedCount"]);
      const unchangedCount = num(response["unchangedCount"]);
      const publicSourceCount = num(response["publicSourceCount"]);

      if (
        !batchId ||
        candidateCount === null ||
        newCount === null ||
        changedCount === null ||
        unchangedCount === null ||
        publicSourceCount === null
      ) {
        return { ok: false, error: "NOT_AVAILABLE" };
      }

      return {
        ok: true,
        batchId,
        candidateCount,
        newCount,
        changedCount,
        unchangedCount,
        publicSourceCount,
      };
    },
  );
