import { savedSourceUrl } from "./diagnostic-source-links";
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { FirstPartySourceType } from "@/lib/first-party-source-classifier";

const SOURCE_TYPES = new Set<FirstPartySourceType>([
  "owned_domain",
  "naver_place",
  "naver_blog",
]);

export type VerifiedFirstPartySourceTypesResponse =
  | { ok: true; sourceTypes: FirstPartySourceType[]; publicPages: { sourceType: FirstPartySourceType; url: string }[] }
  | {
      ok: false;
      error:
        | "FORBIDDEN"
        | "BUSINESS_NOT_AVAILABLE"
        | "FIRST_PARTY_REGISTRY_READ_FAILED";
    };

/**
 * Dashboard-safe first-party registry reader.
 *
 * Returns verified labels and their public destinations for this business only.
 */
export const getVerifiedFirstPartySourceTypes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { orgId: string; businessId: string }) => {
    if (!input?.orgId || typeof input.orgId !== "string") {
      throw new Error("INVALID_ORG");
    }
    if (!input?.businessId || typeof input.businessId !== "string") {
      throw new Error("INVALID_BUSINESS");
    }
    return { orgId: input.orgId, businessId: input.businessId };
  })
  .handler(
    async ({ data, context }): Promise<VerifiedFirstPartySourceTypesResponse> => {
      const { data: business, error: businessError } = await context.supabase
        .from("businesses")
        .select("id")
        .eq("id", data.businessId)
        .eq("org_id", data.orgId)
        .maybeSingle();

      if (businessError) {
        return { ok: false, error: "FORBIDDEN" };
      }
      if (!business) {
        return { ok: false, error: "BUSINESS_NOT_AVAILABLE" };
      }

      const { data: rows, error } = await context.supabase
        .from("business_first_party_sources")
        .select("source_type,canonical_url,normalized_host")
        .eq("org_id", data.orgId)
        .eq("business_id", data.businessId)
        .eq("active", true)
        .eq("verification_status", "verified");

      if (error) {
        return { ok: false, error: "FIRST_PARTY_REGISTRY_READ_FAILED" };
      }

      const sourceTypes = Array.from(
        new Set(
          (rows ?? [])
            .map((row) => row.source_type)
            .filter(
              (sourceType): sourceType is FirstPartySourceType =>
                typeof sourceType === "string" &&
                SOURCE_TYPES.has(sourceType as FirstPartySourceType),
            ),
        ),
      );

      const publicPages = (rows ?? []).flatMap(row => {
        const sourceType = sourceTypes.find(type => type === row.source_type);
        const url = savedSourceUrl(row.canonical_url, row.normalized_host);
        return sourceType && url ? [{ sourceType, url }] : [];
      }).sort((a, b) => a.url.localeCompare(b.url));
      return { ok: true, sourceTypes, publicPages };
    },
  );
