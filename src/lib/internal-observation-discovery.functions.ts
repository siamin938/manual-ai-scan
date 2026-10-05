import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

type RpcCaller = {
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: unknown }>;
};

type FunctionInvoker = {
  functions: {
    invoke: (
      fn: string,
      options?: { body?: unknown },
    ) => PromiseLike<{ data: unknown; error: unknown }>;
  };
};

export type InternalObservationDiscoveryDuplicateStatus =
  | "none"
  | "existing_business_exact"
  | "existing_pipeline_exact"
  | "existing_domain_overlap";

export type InternalObservationDiscoveryEvidenceDTO = {
  url: string;
  domain: string;
  title: string | null;
  note: string | null;
};

export type InternalObservationDiscoveryCandidateDTO = {
  name: string;
  category: string;
  service: string;
  region: string;
  city: string | null;
  websiteUrl: string | null;
  publicProfileUrls: string[];
  evidence: InternalObservationDiscoveryEvidenceDTO[];
  duplicateStatus: InternalObservationDiscoveryDuplicateStatus;
  duplicateWarnings: string[];
  matchedExistingBusinessName: string | null;
  matchedPipelineBusinessName: string | null;
};

export type InternalObservationDiscoveryPreviewDTO = {
  version: "0.9.1-read-only";
  generatedAt: string;
  readOnly: true;
  persisted: false;
  measurementSideEffects: false;
  measurementCreditDebited: false;
  orgId: string;
  orgName: string;
  query: {
    category: string;
    service: string;
    region: string;
    city: string | null;
    brandModel: string | null;
    desiredCount: number;
  };
  provider: "openai";
  model: string;
  publicSourceCount: number;
  candidates: InternalObservationDiscoveryCandidateDTO[];
};

export type GetInternalObservationDiscoveryPreviewResult =
  | { ok: true; preview: InternalObservationDiscoveryPreviewDTO }
  | {
      ok: false;
      error:
        | "FORBIDDEN"
        | "INVALID_INPUT"
        | "DISCOVERY_FAILED"
        | "NOT_AVAILABLE";
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function clean(value: string | null | undefined, max = 300): string {
  return (value ?? "")
    .normalize("NFKC")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, max);
}

function nullableString(value: unknown): string | null | undefined {
  if (value === null) return null;
  return typeof value === "string" ? value : undefined;
}

function parseEvidence(value: unknown): InternalObservationDiscoveryEvidenceDTO | null {
  if (!isRecord(value)) return null;
  const url = typeof value.url === "string" ? value.url : null;
  const domain = typeof value.domain === "string" ? value.domain : null;
  const title = nullableString(value.title);
  const note = nullableString(value.note);
  if (!url || !domain || title === undefined || note === undefined) return null;
  return { url, domain, title, note };
}

function parseCandidate(value: unknown): InternalObservationDiscoveryCandidateDTO | null {
  if (!isRecord(value)) return null;

  const duplicateStatus = value.duplicateStatus;
  if (
    duplicateStatus !== "none" &&
    duplicateStatus !== "existing_business_exact" &&
    duplicateStatus !== "existing_pipeline_exact" &&
    duplicateStatus !== "existing_domain_overlap"
  ) {
    return null;
  }

  const name = typeof value.name === "string" ? value.name : null;
  const category = typeof value.category === "string" ? value.category : null;
  const service = typeof value.service === "string" ? value.service : null;
  const region = typeof value.region === "string" ? value.region : null;
  const city = nullableString(value.city);
  const websiteUrl = nullableString(value.websiteUrl);
  const matchedExistingBusinessName = nullableString(
    value.matchedExistingBusinessName,
  );
  const matchedPipelineBusinessName = nullableString(
    value.matchedPipelineBusinessName,
  );

  const publicProfileUrls = Array.isArray(value.publicProfileUrls)
    ? value.publicProfileUrls.filter(
        (item): item is string => typeof item === "string",
      )
    : null;
  const duplicateWarnings = Array.isArray(value.duplicateWarnings)
    ? value.duplicateWarnings.filter(
        (item): item is string => typeof item === "string",
      )
    : null;
  const evidence = Array.isArray(value.evidence)
    ? value.evidence.map(parseEvidence)
    : null;

  if (
    !name ||
    !category ||
    !service ||
    !region ||
    city === undefined ||
    websiteUrl === undefined ||
    matchedExistingBusinessName === undefined ||
    matchedPipelineBusinessName === undefined ||
    !publicProfileUrls ||
    !duplicateWarnings ||
    !evidence ||
    evidence.some((item) => item === null)
  ) {
    return null;
  }

  return {
    name,
    category,
    service,
    region,
    city,
    websiteUrl,
    publicProfileUrls,
    evidence: evidence as InternalObservationDiscoveryEvidenceDTO[],
    duplicateStatus,
    duplicateWarnings,
    matchedExistingBusinessName,
    matchedPipelineBusinessName,
  };
}

function parsePreview(value: unknown): InternalObservationDiscoveryPreviewDTO | null {
  if (!isRecord(value)) return null;
  if (
    value.version !== "0.9.1-read-only" ||
    value.readOnly !== true ||
    value.persisted !== false ||
    value.measurementSideEffects !== false ||
    value.measurementCreditDebited !== false ||
    value.provider !== "openai" ||
    !isRecord(value.query) ||
    !Array.isArray(value.candidates)
  ) {
    return null;
  }

  const orgId = typeof value.orgId === "string" ? value.orgId : null;
  const orgName = typeof value.orgName === "string" ? value.orgName : null;
  const model = typeof value.model === "string" ? value.model : null;
  const publicSourceCount = Number(value.publicSourceCount);
  const generatedAt =
    typeof value.generatedAt === "string" ? value.generatedAt : null;

  const category =
    typeof value.query.category === "string" ? value.query.category : null;
  const service =
    typeof value.query.service === "string" ? value.query.service : null;
  const region =
    typeof value.query.region === "string" ? value.query.region : null;
  const city = nullableString(value.query.city);
  const brandModel = nullableString(value.query.brandModel);
  const desiredCount = Number(value.query.desiredCount);

  const candidates = value.candidates.map(parseCandidate);

  if (
    !orgId ||
    !orgName ||
    !model ||
    !generatedAt ||
    !Number.isInteger(publicSourceCount) ||
    publicSourceCount < 0 ||
    !category ||
    !service ||
    !region ||
    city === undefined ||
    brandModel === undefined ||
    !Number.isInteger(desiredCount) ||
    desiredCount < 1 ||
    desiredCount > 8 ||
    candidates.some((item) => item === null)
  ) {
    return null;
  }

  return {
    version: "0.9.1-read-only",
    generatedAt,
    readOnly: true,
    persisted: false,
    measurementSideEffects: false,
    measurementCreditDebited: false,
    orgId,
    orgName,
    query: {
      category,
      service,
      region,
      city,
      brandModel,
      desiredCount,
    },
    provider: "openai",
    model,
    publicSourceCount,
    candidates: candidates as InternalObservationDiscoveryCandidateDTO[],
  };
}

async function isInternalAdmin(client: RpcCaller): Promise<boolean> {
  const { data, error } = await client.rpc("can_view_data_asset_admin_v01");
  return !error && data === true;
}

export const getInternalObservationDiscoveryPreview = createServerFn({
  method: "POST",
})
  .inputValidator(
    (input: {
      orgId: string;
      category: string;
      service: string;
      region: string;
      city?: string | null;
      brandModel?: string | null;
      desiredCount?: number;
    }) => {
      const orgId = clean(input?.orgId, 64).toLowerCase();
      const category = clean(input?.category, 100);
      const service = clean(input?.service, 100);
      const region = clean(input?.region, 100);
      const city = clean(input?.city, 100) || null;
      const brandModel = clean(input?.brandModel, 200) || null;
      const desiredCount = Number(input?.desiredCount ?? 5);

      if (
        !UUID_RE.test(orgId) ||
        !category ||
        !service ||
        !region ||
        !Number.isInteger(desiredCount) ||
        desiredCount < 1 ||
        desiredCount > 8
      ) {
        throw new Error("INVALID_INPUT");
      }

      return {
        orgId,
        category,
        service,
        region,
        city,
        brandModel,
        desiredCount,
      };
    },
  )
  .middleware([requireSupabaseAuth])
  .handler(
    async ({
      data,
      context,
    }): Promise<GetInternalObservationDiscoveryPreviewResult> => {
      const client = context.supabase as unknown as RpcCaller & FunctionInvoker;
      if (!(await isInternalAdmin(client))) {
        return { ok: false, error: "FORBIDDEN" };
      }

      const { data: response, error } = await client.functions.invoke(
        "internal-observation-discovery-preview",
        { body: data },
      );

      if (error || !isRecord(response)) {
        return { ok: false, error: "DISCOVERY_FAILED" };
      }

      if (response.ok !== true) {
        return {
          ok: false,
          error:
            response.error === "FORBIDDEN"
              ? "FORBIDDEN"
              : response.error === "INVALID_REQUEST"
                ? "INVALID_INPUT"
                : "DISCOVERY_FAILED",
        };
      }

      const preview = parsePreview(response.preview);
      if (!preview) return { ok: false, error: "NOT_AVAILABLE" };

      return { ok: true, preview };
    },
  );
