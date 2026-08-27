import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  fetchVisibilityCompetitorDetail,
  resolveVisibilityCompetitor,
} from "./visibility-competitor.server";
import type {
  CompetitorDetailResponseDTO,
  CompetitorResolveResponseDTO,
} from "./visibility-competitor.types";

/** `visibility-competitor-resolve` 호출용 얇은 authenticated wrapper. */
export const resolveCompetitor = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { orgId: string; businessId: string; competitorName: string }) => {
    if (!input?.orgId || typeof input.orgId !== "string") throw new Error("INVALID_INPUT");
    if (!input?.businessId || typeof input.businessId !== "string") throw new Error("INVALID_INPUT");
    if (!input?.competitorName || typeof input.competitorName !== "string") {
      throw new Error("INVALID_INPUT");
    }
    return {
      orgId: input.orgId,
      businessId: input.businessId,
      competitorName: input.competitorName,
    };
  })
  .handler(async ({ data, context }): Promise<CompetitorResolveResponseDTO> => {
    return resolveVisibilityCompetitor({
      supabase: context.supabase,
      orgId: data.orgId,
      businessId: data.businessId,
      competitorName: data.competitorName,
    });
  });

/** `visibility-competitor-detail` 호출용 얇은 authenticated wrapper. */
export const getCompetitorDetail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { orgId: string; businessId: string; competitorRef: string }) => {
    if (!input?.orgId || typeof input.orgId !== "string") throw new Error("INVALID_INPUT");
    if (!input?.businessId || typeof input.businessId !== "string") throw new Error("INVALID_INPUT");
    if (!input?.competitorRef || typeof input.competitorRef !== "string") {
      throw new Error("INVALID_INPUT");
    }
    return {
      orgId: input.orgId,
      businessId: input.businessId,
      competitorRef: input.competitorRef,
    };
  })
  .handler(async ({ data, context }): Promise<CompetitorDetailResponseDTO> => {
    return fetchVisibilityCompetitorDetail({
      supabase: context.supabase,
      orgId: data.orgId,
      businessId: data.businessId,
      competitorRef: data.competitorRef,
    });
  });
