import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { businessNameIdentityKey } from "@/lib/business-registration.helpers";
import {
  buildInternalObservationCandidateIdempotencyKey,
  enqueueInternalObservationCandidateCore,
} from "@/lib/internal-observation-pipeline.functions";

export const INTERNAL_OBSERVATION_DISCOVERY_PROMOTION_CONFIRMATION =
  "기존 파이프라인으로 승격" as const;

export type InternalObservationDiscoveryPromotionBlocker =
  | "REVIEW_NOT_APPROVED"
  | "ALREADY_PROMOTED"
  | "PUBLIC_EVIDENCE_MISSING"
  | "BUSINESS_IDENTITY_AMBIGUOUS"
  | "EXISTING_BUSINESS_INACTIVE";

export type InternalObservationDiscoveryPromotionPlanDTO = {
  version: "0.9.3";
  generatedAt: string;
  orgId: string;
  reviewItemId: string;
  businessName: string;
  category: string;
  service: string;
  region: string;
  city: string | null;
  websiteUrl: string | null;
  brandModel: string | null;
  sourceEvidenceCount: number;
  reviewStatus: string;
  duplicateStatus: string;
  existingBusiness: {
    id: string;
    name: string;
    active: boolean;
  } | null;
  existingPipelineItemId: string | null;
  action: "create_pending_candidate" | "link_existing_candidate";
  targetPipelineStatus: "pending";
  blockers: InternalObservationDiscoveryPromotionBlocker[];
  canPromote: boolean;
  measurementSideEffects: false;
  measurementCreditDebited: false;
  runCreated: false;
  jobsCreated: false;
  confirmationText: typeof INTERNAL_OBSERVATION_DISCOVERY_PROMOTION_CONFIRMATION;
  planHash: string;
};

export type PreviewInternalObservationDiscoveryPromotionResult =
  | { ok: true; plan: InternalObservationDiscoveryPromotionPlanDTO }
  | {
      ok: false;
      error: "FORBIDDEN" | "INVALID_INPUT" | "NOT_AVAILABLE";
    };

export type ConfirmInternalObservationDiscoveryPromotionResult =
  | {
      ok: true;
      reviewItemId: string;
      pipelineItemId: string;
      idempotent: boolean;
      action: "create_pending_candidate" | "link_existing_candidate";
    }
  | {
      ok: false;
      error:
        | "FORBIDDEN"
        | "INVALID_INPUT"
        | "INVALID_CONFIRMATION"
        | "PLAN_CHANGED"
        | "PLAN_BLOCKED"
        | "PROMOTION_FAILED"
        | "LINK_FAILED";
      plan?: InternalObservationDiscoveryPromotionPlanDTO;
    };

type LooseQuery = {
  select: (columns?: string) => LooseQuery;
  insert: (values: unknown) => LooseQuery;
  update: (values: unknown) => LooseQuery;
  eq: (column: string, value: unknown) => LooseQuery;
  is: (column: string, value: null) => LooseQuery;
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

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function buildPromotionPlan(args: {
  orgId: string;
  reviewItemId: string;
}): Promise<InternalObservationDiscoveryPromotionPlanDTO | null> {
  const { data: reviewRaw, error: reviewError } = await admin
    .from("internal_observation_discovery_candidates")
    .select(
      [
        "id",
        "org_id",
        "review_status",
        "business_name",
        "category",
        "service",
        "region",
        "city",
        "website_url",
        "source_evidence",
        "discovery_query",
        "duplicate_status",
        "promoted_pipeline_item_id",
      ].join(","),
    )
    .eq("id", args.reviewItemId)
    .eq("org_id", args.orgId)
    .maybeSingle();

  if (reviewError || !isRecord(reviewRaw)) return null;

  const businessName = str(reviewRaw["business_name"]);
  const category = str(reviewRaw["category"]);
  const service = str(reviewRaw["service"]);
  const region = str(reviewRaw["region"]);
  const city = nullableStr(reviewRaw["city"]);
  const websiteUrl = nullableStr(reviewRaw["website_url"]);
  const reviewStatus = str(reviewRaw["review_status"]);
  const duplicateStatus = str(reviewRaw["duplicate_status"]) ?? "none";
  const promotedPipelineItemId = nullableStr(
    reviewRaw["promoted_pipeline_item_id"],
  );
  const sourceEvidence = Array.isArray(reviewRaw["source_evidence"])
    ? reviewRaw["source_evidence"]
    : null;
  const discoveryQuery = isRecord(reviewRaw["discovery_query"])
    ? reviewRaw["discovery_query"]
    : null;
  const brandModel = discoveryQuery
    ? nullableStr(discoveryQuery["brandModel"])
    : undefined;

  if (
    !businessName ||
    !category ||
    !service ||
    !region ||
    city === undefined ||
    websiteUrl === undefined ||
    !reviewStatus ||
    promotedPipelineItemId === undefined ||
    !sourceEvidence ||
    brandModel === undefined
  ) {
    return null;
  }

  const { data: businessRowsRaw, error: businessError } = await admin
    .from("businesses")
    .select("id,name,active")
    .eq("org_id", args.orgId)
    .eq("is_client_business", true);

  if (businessError) return null;

  const identityKey = businessNameIdentityKey(businessName);
  const matchingBusinesses = (Array.isArray(businessRowsRaw)
    ? businessRowsRaw
    : []
  ).filter((row) => {
    if (!isRecord(row)) return false;
    const name = str(row["name"]);
    return !!name && businessNameIdentityKey(name) === identityKey;
  });

  const candidateIdempotencyKey =
    buildInternalObservationCandidateIdempotencyKey({
      orgId: args.orgId,
      businessName,
      region,
      city,
      service,
      brandModel,
      customerNeed: null,
    });

  const { data: pipelineRaw, error: pipelineError } = await admin
    .from("internal_observation_pipeline_items")
    .select("id")
    .eq("org_id", args.orgId)
    .eq("idempotency_key", candidateIdempotencyKey)
    .maybeSingle();

  if (pipelineError) return null;

  const existingPipelineItemId = isRecord(pipelineRaw)
    ? str(pipelineRaw["id"])
    : null;

  const blockers: InternalObservationDiscoveryPromotionBlocker[] = [];
  if (reviewStatus !== "approved") blockers.push("REVIEW_NOT_APPROVED");
  if (promotedPipelineItemId) blockers.push("ALREADY_PROMOTED");
  if (sourceEvidence.length < 1) blockers.push("PUBLIC_EVIDENCE_MISSING");
  if (matchingBusinesses.length > 1) {
    blockers.push("BUSINESS_IDENTITY_AMBIGUOUS");
  }

  const matchedBusiness =
    matchingBusinesses.length === 1 && isRecord(matchingBusinesses[0])
      ? matchingBusinesses[0]
      : null;
  const existingBusiness = matchedBusiness
    ? {
        id: str(matchedBusiness["id"]) ?? "",
        name: str(matchedBusiness["name"]) ?? businessName,
        active: matchedBusiness["active"] === true,
      }
    : null;

  if (existingBusiness && !existingBusiness.active) {
    blockers.push("EXISTING_BUSINESS_INACTIVE");
  }

  const fingerprint = {
    version: "0.9.3",
    orgId: args.orgId,
    reviewItemId: args.reviewItemId,
    reviewStatus,
    promotedPipelineItemId,
    businessName,
    category,
    service,
    region,
    city,
    websiteUrl,
    brandModel,
    sourceEvidenceCount: sourceEvidence.length,
    duplicateStatus,
    existingBusiness,
    existingPipelineItemId,
    action: existingPipelineItemId
      ? "link_existing_candidate"
      : "create_pending_candidate",
    blockers,
  };

  const planHash = await sha256(JSON.stringify(fingerprint));

  return {
    version: "0.9.3",
    generatedAt: new Date().toISOString(),
    orgId: args.orgId,
    reviewItemId: args.reviewItemId,
    businessName,
    category,
    service,
    region,
    city,
    websiteUrl,
    brandModel,
    sourceEvidenceCount: sourceEvidence.length,
    reviewStatus,
    duplicateStatus,
    existingBusiness,
    existingPipelineItemId,
    action: existingPipelineItemId
      ? "link_existing_candidate"
      : "create_pending_candidate",
    targetPipelineStatus: "pending",
    blockers,
    canPromote: blockers.length === 0,
    measurementSideEffects: false,
    measurementCreditDebited: false,
    runCreated: false,
    jobsCreated: false,
    confirmationText: INTERNAL_OBSERVATION_DISCOVERY_PROMOTION_CONFIRMATION,
    planHash,
  };
}

export const previewInternalObservationDiscoveryPromotion = createServerFn({
  method: "POST",
})
  .inputValidator((input: { orgId: string; reviewItemId: string }) => {
    const orgId = clean(input?.orgId, 64).toLowerCase();
    const reviewItemId = clean(input?.reviewItemId, 64).toLowerCase();
    if (!UUID_RE.test(orgId) || !UUID_RE.test(reviewItemId)) {
      throw new Error("INVALID_INPUT");
    }
    return { orgId, reviewItemId };
  })
  .middleware([requireSupabaseAuth])
  .handler(
    async ({
      data,
      context,
    }): Promise<PreviewInternalObservationDiscoveryPromotionResult> => {
      const client = context.supabase as unknown as RpcCaller;
      if (
        !(await isInternalAdmin(client)) ||
        !(await canOperateOrg(data.orgId, context.userId))
      ) {
        return { ok: false, error: "FORBIDDEN" };
      }

      const plan = await buildPromotionPlan(data);
      if (!plan) return { ok: false, error: "NOT_AVAILABLE" };
      return { ok: true, plan };
    },
  );

export const confirmInternalObservationDiscoveryPromotion = createServerFn({
  method: "POST",
})
  .inputValidator(
    (input: {
      orgId: string;
      reviewItemId: string;
      planHash: string;
      confirmation: string;
    }) => {
      const orgId = clean(input?.orgId, 64).toLowerCase();
      const reviewItemId = clean(input?.reviewItemId, 64).toLowerCase();
      const planHash = clean(input?.planHash, 128).toLowerCase();
      const confirmation = clean(input?.confirmation, 100);

      if (
        !UUID_RE.test(orgId) ||
        !UUID_RE.test(reviewItemId) ||
        !/^[0-9a-f]{64}$/u.test(planHash)
      ) {
        throw new Error("INVALID_INPUT");
      }

      return { orgId, reviewItemId, planHash, confirmation };
    },
  )
  .middleware([requireSupabaseAuth])
  .handler(
    async ({
      data,
      context,
    }): Promise<ConfirmInternalObservationDiscoveryPromotionResult> => {
      const client = context.supabase as unknown as RpcCaller;
      if (
        !(await isInternalAdmin(client)) ||
        !(await canOperateOrg(data.orgId, context.userId))
      ) {
        return { ok: false, error: "FORBIDDEN" };
      }

      if (
        data.confirmation !==
        INTERNAL_OBSERVATION_DISCOVERY_PROMOTION_CONFIRMATION
      ) {
        return { ok: false, error: "INVALID_CONFIRMATION" };
      }

      const plan = await buildPromotionPlan({
        orgId: data.orgId,
        reviewItemId: data.reviewItemId,
      });
      if (!plan) return { ok: false, error: "PROMOTION_FAILED" };

      if (plan.planHash !== data.planHash) {
        return { ok: false, error: "PLAN_CHANGED", plan };
      }
      if (!plan.canPromote) {
        return { ok: false, error: "PLAN_BLOCKED", plan };
      }

      const intake = await enqueueInternalObservationCandidateCore(
        {
          orgId: plan.orgId,
          businessName: plan.businessName,
          aliases: [],
          category: plan.category,
          region: plan.region,
          city: plan.city,
          address: null,
          websiteUrl: plan.websiteUrl,
          naverPlaceUrl: null,
          googleMapsUrl: null,
          service: plan.service,
          brandModel: plan.brandModel,
          customerNeed: null,
          sourceLabel: `Discovery Review v0.9.3 · ${plan.reviewItemId}`,
        },
        context.userId,
      );

      if (!intake.ok) {
        return { ok: false, error: "PROMOTION_FAILED" };
      }

      const now = new Date().toISOString();
      const { data: linkedRaw, error: linkError } = await admin
        .from("internal_observation_discovery_candidates")
        .update({
          promoted_pipeline_item_id: intake.itemId,
          promoted_at: now,
          promoted_by: context.userId,
        })
        .eq("id", plan.reviewItemId)
        .eq("org_id", plan.orgId)
        .eq("review_status", "approved")
        .is("promoted_pipeline_item_id", null)
        .select("id,promoted_pipeline_item_id")
        .maybeSingle();

      if (linkError || !isRecord(linkedRaw)) {
        const { data: currentRaw } = await admin
          .from("internal_observation_discovery_candidates")
          .select("promoted_pipeline_item_id")
          .eq("id", plan.reviewItemId)
          .eq("org_id", plan.orgId)
          .maybeSingle();

        if (
          !isRecord(currentRaw) ||
          str(currentRaw["promoted_pipeline_item_id"]) !== intake.itemId
        ) {
          return { ok: false, error: "LINK_FAILED" };
        }
      }

      await admin.from("system_events").insert({
        org_id: plan.orgId,
        run_id: null,
        event_type: "internal_discovery_candidate_promoted",
        severity: "info",
        message:
          "Approved discovery candidate was explicitly promoted into the existing internal candidate intake.",
        metadata: {
          discovery_candidate_id: plan.reviewItemId,
          business_name: plan.businessName,
          pipeline_item_id: intake.itemId,
          intake_idempotent: intake.idempotent,
          action: plan.action,
          actor_user_id: context.userId,
          discovery_version: "0.9.3",
          pipeline_status: "pending",
          measurement_side_effects: false,
          measurement_credit_debited: false,
          run_created: false,
          jobs_created: false,
        },
      });

      return {
        ok: true,
        reviewItemId: plan.reviewItemId,
        pipelineItemId: intake.itemId,
        idempotent: intake.idempotent,
        action: plan.action,
      };
    },
  );
