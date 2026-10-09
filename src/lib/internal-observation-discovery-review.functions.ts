import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  businessNameIdentityKey,
  normalizeOptionalPublicUrl,
} from "@/lib/business-registration.helpers";

export type InternalObservationDiscoveryReviewStatus =
  | "needs_review"
  | "approved"
  | "rejected"
  | "duplicate"
  | "needs_identity_review";

export type InternalObservationDiscoveryDuplicateStatus =
  | "none"
  | "existing_business_exact"
  | "existing_pipeline_exact"
  | "existing_domain_overlap";

export type InternalObservationDiscoveryReviewEvidenceDTO = {
  url: string;
  domain: string;
  title: string | null;
  note: string | null;
};

export type InternalObservationDiscoveryReviewItemDTO = {
  id: string;
  orgId: string;
  reviewStatus: InternalObservationDiscoveryReviewStatus;
  discoverySource: "web_preview" | "scheduled_web" | "manual" | "work";
  businessName: string;
  category: string;
  service: string;
  region: string;
  city: string | null;
  websiteUrl: string | null;
  publicProfileUrls: string[];
  sourceEvidence: InternalObservationDiscoveryReviewEvidenceDTO[];
  discoveryQuery: {
    category: string;
    service: string;
    region: string;
    city: string | null;
    brandModel: string | null;
    desiredCount: number;
  };
  duplicateStatus: InternalObservationDiscoveryDuplicateStatus;
  duplicateWarnings: string[];
  matchedExistingBusinessName: string | null;
  matchedPipelineBusinessName: string | null;
  previewGeneratedAt: string | null;
  firstDiscoveredAt: string;
  lastSeenAt: string;
  reviewedAt: string | null;
  reviewNote: string | null;
  promotedPipelineItemId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type InternalObservationDiscoveryReviewOverviewDTO = {
  version: "0.9.2";
  generatedAt: string;
  items: InternalObservationDiscoveryReviewItemDTO[];
};

export type GetInternalObservationDiscoveryReviewQueueResult =
  | { ok: true; overview: InternalObservationDiscoveryReviewOverviewDTO }
  | { ok: false; error: "FORBIDDEN" | "INVALID_INPUT" | "NOT_AVAILABLE" };

export type SaveInternalObservationDiscoveryCandidateResult =
  | {
      ok: true;
      item: InternalObservationDiscoveryReviewItemDTO;
      idempotent: boolean;
    }
  | {
      ok: false;
      error: "FORBIDDEN" | "INVALID_INPUT" | "NOT_AVAILABLE";
    };

export type UpdateInternalObservationDiscoveryReviewResult =
  | { ok: true; item: InternalObservationDiscoveryReviewItemDTO }
  | {
      ok: false;
      error:
        | "FORBIDDEN"
        | "INVALID_INPUT"
        | "NOT_AVAILABLE"
        | "ALREADY_PROMOTED";
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
};

const admin = supabaseAdmin as unknown as LooseAdmin;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

const REVIEW_STATUSES: InternalObservationDiscoveryReviewStatus[] = [
  "needs_review",
  "approved",
  "rejected",
  "duplicate",
  "needs_identity_review",
];

const DUPLICATE_STATUSES: InternalObservationDiscoveryDuplicateStatus[] = [
  "none",
  "existing_business_exact",
  "existing_pipeline_exact",
  "existing_domain_overlap",
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

function normalizedKeyPart(value: string | null | undefined): string {
  return clean(value, 300).toLocaleLowerCase("ko-KR");
}

function normalizePublicUrl(
  value: string | null | undefined,
): string | null | undefined {
  const parsed = normalizeOptionalPublicUrl(value);
  return parsed.ok ? parsed.value : undefined;
}

function normalizePublicUrls(values: unknown): string[] | null {
  if (!Array.isArray(values)) return null;
  const out: string[] = [];
  for (const raw of values) {
    if (typeof raw !== "string") return null;
    const normalized = normalizePublicUrl(raw);
    if (normalized === undefined || normalized === null) return null;
    if (!out.includes(normalized)) out.push(normalized);
  }
  return out.slice(0, 10);
}

function domainFromUrl(value: string): string | null {
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./u, "");
  } catch {
    return null;
  }
}

function parseEvidenceInput(
  values: unknown,
): InternalObservationDiscoveryReviewEvidenceDTO[] | null {
  if (!Array.isArray(values) || values.length < 1 || values.length > 50) {
    return null;
  }

  const out: InternalObservationDiscoveryReviewEvidenceDTO[] = [];
  for (const value of values) {
    if (!isRecord(value)) return null;
    const rawUrl = str(value["url"]);
    const rawDomain = str(value["domain"]);
    const rawTitle = nullableStr(value["title"]);
    const rawNote = nullableStr(value["note"]);
    if (!rawUrl || !rawDomain || rawTitle === undefined || rawNote === undefined) {
      return null;
    }

    const url = normalizePublicUrl(rawUrl);
    if (!url) return null;
    const domain = domainFromUrl(url);
    if (!domain || domain !== clean(rawDomain, 255).toLowerCase().replace(/^www\./u, "")) {
      return null;
    }

    if (out.some((item) => item.url === url)) continue;
    out.push({
      url,
      domain,
      title: cleanOptional(rawTitle, 500),
      note: cleanOptional(rawNote, 500),
    });
  }

  return out.length > 0 ? out : null;
}

function parseStringArray(values: unknown, maxItems = 20): string[] | null {
  if (!Array.isArray(values) || values.length > maxItems) return null;
  const out: string[] = [];
  for (const value of values) {
    if (typeof value !== "string") return null;
    const cleaned = clean(value, 500);
    if (cleaned && !out.includes(cleaned)) out.push(cleaned);
  }
  return out;
}

function parseIsoDate(value: string | null | undefined): string | null | undefined {
  if (value === null || value === undefined || value === "") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function reviewIdempotencyKey(input: {
  orgId: string;
  businessName: string;
  region: string;
  city: string | null;
  service: string;
}): string {
  return [
    "v0.9.2",
    input.orgId.toLowerCase(),
    businessNameIdentityKey(input.businessName),
    normalizedKeyPart(input.region),
    normalizedKeyPart(input.city),
    normalizedKeyPart(input.service),
  ].join("|");
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

  if (orgRes.error || memberRes.error || !isRecord(orgRes.data) || !isRecord(memberRes.data)) {
    return false;
  }

  const role = str(memberRes.data["role"]);
  return role === "owner" || role === "admin" || role === "analyst";
}

function parseItem(value: unknown): InternalObservationDiscoveryReviewItemDTO | null {
  if (!isRecord(value)) return null;

  const id = str(value["id"]);
  const orgId = str(value["org_id"]);
  const reviewStatus = str(value["review_status"]);
  const discoverySource = str(value["discovery_source"]);
  const businessName = str(value["business_name"]);
  const category = str(value["category"]);
  const service = str(value["service"]);
  const region = str(value["region"]);
  const city = nullableStr(value["city"]);
  const websiteUrl = nullableStr(value["website_url"]);
  const sourceEvidence = parseEvidenceInput(value["source_evidence"]);
  const publicProfileUrls = normalizePublicUrls(value["public_profile_urls"]);
  const duplicateStatus = str(value["duplicate_status"]);
  const duplicateWarnings = parseStringArray(value["duplicate_warnings"]);
  const matchedExistingBusinessName = nullableStr(value["matched_existing_business_name"]);
  const matchedPipelineBusinessName = nullableStr(value["matched_pipeline_business_name"]);
  const previewGeneratedAt = nullableStr(value["preview_generated_at"]);
  const firstDiscoveredAt = str(value["first_discovered_at"]);
  const lastSeenAt = str(value["last_seen_at"]);
  const reviewedAt = nullableStr(value["reviewed_at"]);
  const reviewNote = nullableStr(value["review_note"]);
  const promotedPipelineItemId = nullableStr(value["promoted_pipeline_item_id"]);
  const createdAt = str(value["created_at"]);
  const updatedAt = str(value["updated_at"]);

  const queryRaw = value["discovery_query"];
  if (!isRecord(queryRaw)) return null;
  const queryCategory = str(queryRaw["category"]);
  const queryService = str(queryRaw["service"]);
  const queryRegion = str(queryRaw["region"]);
  const queryCity = nullableStr(queryRaw["city"]);
  const queryBrandModel = nullableStr(queryRaw["brandModel"]);
  const queryDesiredCount = Number(queryRaw["desiredCount"]);

  if (
    !id ||
    !orgId ||
    !reviewStatus ||
    !REVIEW_STATUSES.includes(reviewStatus as InternalObservationDiscoveryReviewStatus) ||
    (discoverySource !== "web_preview" &&
      discoverySource !== "scheduled_web" &&
      discoverySource !== "manual" &&
      discoverySource !== "work") ||
    !businessName ||
    !category ||
    !service ||
    !region ||
    city === undefined ||
    websiteUrl === undefined ||
    !sourceEvidence ||
    !publicProfileUrls ||
    !duplicateStatus ||
    !DUPLICATE_STATUSES.includes(
      duplicateStatus as InternalObservationDiscoveryDuplicateStatus,
    ) ||
    !duplicateWarnings ||
    matchedExistingBusinessName === undefined ||
    matchedPipelineBusinessName === undefined ||
    previewGeneratedAt === undefined ||
    !firstDiscoveredAt ||
    !lastSeenAt ||
    reviewedAt === undefined ||
    reviewNote === undefined ||
    promotedPipelineItemId === undefined ||
    !createdAt ||
    !updatedAt ||
    !queryCategory ||
    !queryService ||
    !queryRegion ||
    queryCity === undefined ||
    queryBrandModel === undefined ||
    !Number.isInteger(queryDesiredCount) ||
    queryDesiredCount < 1 ||
    queryDesiredCount > 8
  ) {
    return null;
  }

  return {
    id,
    orgId,
    reviewStatus: reviewStatus as InternalObservationDiscoveryReviewStatus,
    discoverySource,
    businessName,
    category,
    service,
    region,
    city,
    websiteUrl,
    publicProfileUrls,
    sourceEvidence,
    discoveryQuery: {
      category: queryCategory,
      service: queryService,
      region: queryRegion,
      city: queryCity,
      brandModel: queryBrandModel,
      desiredCount: queryDesiredCount,
    },
    duplicateStatus:
      duplicateStatus as InternalObservationDiscoveryDuplicateStatus,
    duplicateWarnings,
    matchedExistingBusinessName,
    matchedPipelineBusinessName,
    previewGeneratedAt,
    firstDiscoveredAt,
    lastSeenAt,
    reviewedAt,
    reviewNote,
    promotedPipelineItemId,
    createdAt,
    updatedAt,
  };
}

const ITEM_SELECT = [
  "id",
  "org_id",
  "review_status",
  "discovery_source",
  "business_name",
  "category",
  "service",
  "region",
  "city",
  "website_url",
  "public_profile_urls",
  "source_evidence",
  "discovery_query",
  "duplicate_status",
  "duplicate_warnings",
  "matched_existing_business_name",
  "matched_pipeline_business_name",
  "preview_generated_at",
  "first_discovered_at",
  "last_seen_at",
  "reviewed_at",
  "review_note",
  "promoted_pipeline_item_id",
  "created_at",
  "updated_at",
].join(",");

export const getInternalObservationDiscoveryReviewQueue = createServerFn({
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
    }): Promise<GetInternalObservationDiscoveryReviewQueueResult> => {
      const client = context.supabase as unknown as RpcCaller;
      if (
        !(await isInternalAdmin(client)) ||
        !(await canOperateOrg(data.orgId, context.userId))
      ) {
        return { ok: false, error: "FORBIDDEN" };
      }

      const { data: rowsRaw, error } = await admin
        .from("internal_observation_discovery_candidates")
        .select(ITEM_SELECT)
        .eq("org_id", data.orgId)
        .order("created_at", { ascending: false })
        .limit(300);

      if (error) return { ok: false, error: "NOT_AVAILABLE" };

      const rows = Array.isArray(rowsRaw) ? rowsRaw : [];
      const parsed = rows.map(parseItem);
      if (parsed.some((item) => item === null)) {
        return { ok: false, error: "NOT_AVAILABLE" };
      }

      const priority: Record<InternalObservationDiscoveryReviewStatus, number> = {
        needs_review: 0,
        needs_identity_review: 1,
        approved: 2,
        duplicate: 3,
        rejected: 4,
      };

      const items = (parsed as InternalObservationDiscoveryReviewItemDTO[]).sort(
        (a, b) =>
          priority[a.reviewStatus] - priority[b.reviewStatus] ||
          b.lastSeenAt.localeCompare(a.lastSeenAt),
      );

      return {
        ok: true,
        overview: {
          version: "0.9.2",
          generatedAt: new Date().toISOString(),
          items,
        },
      };
    },
  );

export const saveInternalObservationDiscoveryCandidate = createServerFn({
  method: "POST",
})
  .inputValidator(
    (input: {
      orgId: string;
      previewGeneratedAt: string;
      query: {
        category: string;
        service: string;
        region: string;
        city?: string | null;
        brandModel?: string | null;
        desiredCount: number;
      };
      candidate: {
        name: string;
        category: string;
        service: string;
        region: string;
        city?: string | null;
        websiteUrl?: string | null;
        publicProfileUrls: string[];
        evidence: Array<{
          url: string;
          domain: string;
          title?: string | null;
          note?: string | null;
        }>;
        duplicateStatus: InternalObservationDiscoveryDuplicateStatus;
        duplicateWarnings: string[];
        matchedExistingBusinessName?: string | null;
        matchedPipelineBusinessName?: string | null;
      };
    }) => {
      const orgId = clean(input?.orgId, 64).toLowerCase();
      const previewGeneratedAt = parseIsoDate(input?.previewGeneratedAt);
      const query = input?.query;
      const candidate = input?.candidate;
      if (
        !UUID_RE.test(orgId) ||
        !previewGeneratedAt ||
        !query ||
        !candidate
      ) {
        throw new Error("INVALID_INPUT");
      }

      const queryCategory = clean(query.category, 100);
      const queryService = clean(query.service, 100);
      const queryRegion = clean(query.region, 100);
      const queryCity = cleanOptional(query.city, 100);
      const queryBrandModel = cleanOptional(query.brandModel, 200);
      const queryDesiredCount = Number(query.desiredCount);

      const businessName = clean(candidate.name, 140);
      const category = clean(candidate.category, 100);
      const service = clean(candidate.service, 100);
      const region = clean(candidate.region, 100);
      const city = cleanOptional(candidate.city, 100);
      const websiteUrl = normalizePublicUrl(candidate.websiteUrl);
      const publicProfileUrls = normalizePublicUrls(candidate.publicProfileUrls);
      const evidence = parseEvidenceInput(candidate.evidence);
      const duplicateWarnings = parseStringArray(candidate.duplicateWarnings);
      const matchedExistingBusinessName = cleanOptional(
        candidate.matchedExistingBusinessName,
        140,
      );
      const matchedPipelineBusinessName = cleanOptional(
        candidate.matchedPipelineBusinessName,
        140,
      );

      if (
        !queryCategory ||
        !queryService ||
        !queryRegion ||
        !Number.isInteger(queryDesiredCount) ||
        queryDesiredCount < 1 ||
        queryDesiredCount > 8 ||
        !businessName ||
        !category ||
        !service ||
        !region ||
        websiteUrl === undefined ||
        !publicProfileUrls ||
        !evidence ||
        !DUPLICATE_STATUSES.includes(candidate.duplicateStatus) ||
        !duplicateWarnings ||
        category !== queryCategory ||
        service !== queryService ||
        region !== queryRegion
      ) {
        throw new Error("INVALID_INPUT");
      }

      return {
        orgId,
        previewGeneratedAt,
        query: {
          category: queryCategory,
          service: queryService,
          region: queryRegion,
          city: queryCity,
          brandModel: queryBrandModel,
          desiredCount: queryDesiredCount,
        },
        candidate: {
          businessName,
          category,
          service,
          region,
          city,
          websiteUrl,
          publicProfileUrls,
          evidence,
          duplicateStatus: candidate.duplicateStatus,
          duplicateWarnings,
          matchedExistingBusinessName,
          matchedPipelineBusinessName,
        },
      };
    },
  )
  .middleware([requireSupabaseAuth])
  .handler(
    async ({
      data,
      context,
    }): Promise<SaveInternalObservationDiscoveryCandidateResult> => {
      const client = context.supabase as unknown as RpcCaller;
      if (
        !(await isInternalAdmin(client)) ||
        !(await canOperateOrg(data.orgId, context.userId))
      ) {
        return { ok: false, error: "FORBIDDEN" };
      }

      const idempotencyKey = reviewIdempotencyKey({
        orgId: data.orgId,
        businessName: data.candidate.businessName,
        region: data.candidate.region,
        city: data.candidate.city,
        service: data.candidate.service,
      });

      const { data: existingRaw, error: existingError } = await admin
        .from("internal_observation_discovery_candidates")
        .select(ITEM_SELECT)
        .eq("org_id", data.orgId)
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();

      if (existingError) return { ok: false, error: "NOT_AVAILABLE" };

      const now = new Date().toISOString();
      let savedRaw: unknown;
      let idempotent = false;

      if (isRecord(existingRaw)) {
        idempotent = true;
        const { data: updatedRaw, error: updateError } = await admin
          .from("internal_observation_discovery_candidates")
          .update({
            business_name: data.candidate.businessName,
            category: data.candidate.category,
            service: data.candidate.service,
            region: data.candidate.region,
            city: data.candidate.city,
            website_url: data.candidate.websiteUrl,
            public_profile_urls: data.candidate.publicProfileUrls,
            source_evidence: data.candidate.evidence,
            discovery_query: data.query,
            duplicate_status: data.candidate.duplicateStatus,
            duplicate_warnings: data.candidate.duplicateWarnings,
            matched_existing_business_name:
              data.candidate.matchedExistingBusinessName,
            matched_pipeline_business_name:
              data.candidate.matchedPipelineBusinessName,
            preview_generated_at: data.previewGeneratedAt,
            last_seen_at: now,
          })
          .eq("id", str(existingRaw["id"]) ?? "")
          .eq("org_id", data.orgId)
          .select(ITEM_SELECT)
          .single();

        if (updateError) return { ok: false, error: "NOT_AVAILABLE" };
        savedRaw = updatedRaw;
      } else {
        const { data: insertedRaw, error: insertError } = await admin
          .from("internal_observation_discovery_candidates")
          .insert({
            org_id: data.orgId,
            review_status: "needs_review",
            discovery_source: "web_preview",
            idempotency_key: idempotencyKey,
            business_name: data.candidate.businessName,
            category: data.candidate.category,
            service: data.candidate.service,
            region: data.candidate.region,
            city: data.candidate.city,
            website_url: data.candidate.websiteUrl,
            public_profile_urls: data.candidate.publicProfileUrls,
            source_evidence: data.candidate.evidence,
            discovery_query: data.query,
            duplicate_status: data.candidate.duplicateStatus,
            duplicate_warnings: data.candidate.duplicateWarnings,
            matched_existing_business_name:
              data.candidate.matchedExistingBusinessName,
            matched_pipeline_business_name:
              data.candidate.matchedPipelineBusinessName,
            preview_generated_at: data.previewGeneratedAt,
            first_discovered_at: now,
            last_seen_at: now,
            created_by: context.userId,
          })
          .select(ITEM_SELECT)
          .single();

        if (insertError) return { ok: false, error: "NOT_AVAILABLE" };
        savedRaw = insertedRaw;
      }

      const item = parseItem(savedRaw);
      if (!item) return { ok: false, error: "NOT_AVAILABLE" };

      await admin.from("system_events").insert({
        org_id: data.orgId,
        run_id: null,
        event_type: idempotent
          ? "internal_discovery_candidate_seen_again"
          : "internal_discovery_candidate_saved",
        severity: "info",
        message: idempotent
          ? "Existing discovery review candidate was refreshed from a new preview."
          : "Discovery preview candidate was saved for operator review.",
        metadata: {
          discovery_candidate_id: item.id,
          business_name: item.businessName,
          review_status: item.reviewStatus,
          duplicate_status: item.duplicateStatus,
          actor_user_id: context.userId,
          discovery_version: "0.9.2",
          measurement_side_effects: false,
        },
      });

      return { ok: true, item, idempotent };
    },
  );

export const updateInternalObservationDiscoveryReview = createServerFn({
  method: "POST",
})
  .inputValidator(
    (input: {
      orgId: string;
      itemId: string;
      reviewStatus: InternalObservationDiscoveryReviewStatus;
      reviewNote?: string | null;
    }) => {
      const orgId = clean(input?.orgId, 64).toLowerCase();
      const itemId = clean(input?.itemId, 64).toLowerCase();
      const reviewStatus = input?.reviewStatus;
      const reviewNote = cleanOptional(input?.reviewNote, 1000);

      if (
        !UUID_RE.test(orgId) ||
        !UUID_RE.test(itemId) ||
        !REVIEW_STATUSES.includes(reviewStatus)
      ) {
        throw new Error("INVALID_INPUT");
      }

      return { orgId, itemId, reviewStatus, reviewNote };
    },
  )
  .middleware([requireSupabaseAuth])
  .handler(
    async ({
      data,
      context,
    }): Promise<UpdateInternalObservationDiscoveryReviewResult> => {
      const client = context.supabase as unknown as RpcCaller;
      if (
        !(await isInternalAdmin(client)) ||
        !(await canOperateOrg(data.orgId, context.userId))
      ) {
        return { ok: false, error: "FORBIDDEN" };
      }

      const { data: existingRaw, error: existingError } = await admin
        .from("internal_observation_discovery_candidates")
        .select(ITEM_SELECT)
        .eq("id", data.itemId)
        .eq("org_id", data.orgId)
        .maybeSingle();

      if (existingError || !isRecord(existingRaw)) {
        return { ok: false, error: "NOT_AVAILABLE" };
      }

      if (str(existingRaw["promoted_pipeline_item_id"])) {
        return { ok: false, error: "ALREADY_PROMOTED" };
      }

      const previousStatus = str(existingRaw["review_status"]);
      const now = new Date().toISOString();
      const isNeedsReview = data.reviewStatus === "needs_review";

      const { data: updatedRaw, error: updateError } = await admin
        .from("internal_observation_discovery_candidates")
        .update({
          review_status: data.reviewStatus,
          reviewed_by: isNeedsReview ? null : context.userId,
          reviewed_at: isNeedsReview ? null : now,
          review_note: data.reviewNote,
        })
        .eq("id", data.itemId)
        .eq("org_id", data.orgId)
        .select(ITEM_SELECT)
        .single();

      if (updateError) return { ok: false, error: "NOT_AVAILABLE" };

      const item = parseItem(updatedRaw);
      if (!item) return { ok: false, error: "NOT_AVAILABLE" };

      await admin.from("system_events").insert({
        org_id: data.orgId,
        run_id: null,
        event_type: "internal_discovery_review_status_changed",
        severity: "info",
        message: "Discovery review status was changed by an operator.",
        metadata: {
          discovery_candidate_id: data.itemId,
          business_name: item.businessName,
          previous_status: previousStatus,
          review_status: data.reviewStatus,
          review_note: data.reviewNote,
          actor_user_id: context.userId,
          discovery_version: "0.9.2",
          promoted_pipeline_item_id: null,
          measurement_side_effects: false,
        },
      });

      return { ok: true, item };
    },
  );
