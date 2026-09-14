import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  ENTITY_V2_RUNTIME_SHADOW_VERSION,
  runEntityV2RuntimeShadowComparison,
  type EntityV1ResolutionForShadow,
  type EntityV2RuntimeShadowBusiness,
} from "../_shared/entity-engine-v2/runtime-shadow.ts";

const MAX_MEASUREMENTS = 50;
const RESPONSE_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
};

class AppError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) {
    super(code);
    this.name = "AppError";
    this.status = status;
    this.code = code;
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: RESPONSE_HEADERS });
}

function bearerToken(request: Request): string | undefined {
  const raw = request.headers.get("authorization")?.trim() ?? "";
  const match = raw.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || undefined;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function runtimeEnv(): { url: string; secret: string } {
  return {
    url: Deno.env.get("SUPABASE_URL")?.trim() ?? "",
    secret:
      Deno.env.get("SUPABASE_SECRET_KEY")?.trim() ??
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim() ??
      "",
  };
}

function safeMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}

function toShadowBusiness(row: Record<string, unknown>): EntityV2RuntimeShadowBusiness {
  return {
    id: String(row.id),
    name: String(row.name),
    aliases: Array.isArray(row.aliases)
      ? row.aliases.filter((value): value is string => typeof value === "string")
      : [],
  };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: RESPONSE_HEADERS });
  }
  if (request.method !== "POST") {
    return jsonResponse({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
  }

  try {
    const { url, secret } = runtimeEnv();
    if (!url || !secret) throw new AppError(500, "SERVER_NOT_CONFIGURED");

    const token = bearerToken(request);
    if (!token) throw new AppError(401, "AUTH_REQUIRED");

    const client = createClient(url, secret, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { data: authData, error: authError } = await client.auth.getUser(token);
    if (authError || !authData.user) throw new AppError(401, "INVALID_USER_TOKEN");

    let payload: Record<string, unknown> = {};
    try {
      const parsed = await request.json();
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        payload = parsed as Record<string, unknown>;
      }
    } catch {
      throw new AppError(400, "INVALID_JSON");
    }

    const runId = typeof payload.run_id === "string" ? payload.run_id.trim() : "";
    if (!isUuid(runId)) throw new AppError(400, "INVALID_RUN_ID");

    const { data: run, error: runError } = await client
      .from("measurement_runs")
      .select("id,org_id,business_id,status,run_type,phase,experiment_id")
      .eq("id", runId)
      .maybeSingle();
    if (runError) throw new AppError(500, "RUN_LOAD_FAILED");
    if (!run) throw new AppError(404, "RUN_NOT_FOUND");

    const orgId = String(run.org_id);
    const businessId = String(run.business_id);
    const { data: membership, error: membershipError } = await client
      .from("organization_members")
      .select("role")
      .eq("org_id", orgId)
      .eq("user_id", authData.user.id)
      .in("role", ["owner", "admin", "analyst"])
      .maybeSingle();
    if (membershipError) throw new AppError(500, "MEMBERSHIP_LOAD_FAILED");
    if (!membership) throw new AppError(403, "SHADOW_PREVIEW_ROLE_REQUIRED");

    if (
      run.run_type !== "audit" ||
      run.phase !== "standalone" ||
      run.experiment_id !== null
    ) {
      throw new AppError(409, "SHADOW_PREVIEW_STANDALONE_AUDIT_ONLY");
    }

    const { data: target, error: targetError } = await client
      .from("businesses")
      .select("id,name,aliases")
      .eq("id", businessId)
      .eq("org_id", orgId)
      .eq("active", true)
      .maybeSingle();
    if (targetError) throw new AppError(500, "TARGET_LOAD_FAILED");
    if (!target) throw new AppError(404, "TARGET_BUSINESS_NOT_FOUND");

    const { data: links, error: linksError } = await client
      .from("business_competitors")
      .select("competitor_business_id")
      .eq("org_id", orgId)
      .eq("target_business_id", businessId)
      .eq("active", true);
    if (linksError) throw new AppError(500, "COMPETITOR_LINKS_FAILED");

    const competitorIds = (links ?? [])
      .map((row) => String(row.competitor_business_id))
      .filter(Boolean);
    let competitorRows: Record<string, unknown>[] = [];
    if (competitorIds.length > 0) {
      const { data, error } = await client
        .from("businesses")
        .select("id,name,aliases")
        .eq("org_id", orgId)
        .eq("active", true)
        .in("id", competitorIds);
      if (error) throw new AppError(500, "COMPETITOR_LOAD_FAILED");
      competitorRows = (data ?? []) as Record<string, unknown>[];
    }

    const businesses: EntityV2RuntimeShadowBusiness[] = [
      toShadowBusiness(target as Record<string, unknown>),
      ...competitorRows.map(toShadowBusiness),
    ];

    const { data: measurementRows, error: measurementError } = await client
      .from("measurements")
      .select("id,response_text,parser_version,valid,created_at")
      .eq("org_id", orgId)
      .eq("run_id", runId)
      .order("created_at", { ascending: true })
      .range(0, MAX_MEASUREMENTS);
    if (measurementError) throw new AppError(500, "MEASUREMENTS_LOAD_FAILED");

    const measurements = (measurementRows ?? []) as Record<string, unknown>[];
    if (measurements.length > MAX_MEASUREMENTS) {
      throw new AppError(413, "TOO_MANY_MEASUREMENTS");
    }
    if (measurements.length === 0) {
      return jsonResponse({
        ok: true,
        mode: "entity-v2-shadow-preview",
        version: ENTITY_V2_RUNTIME_SHADOW_VERSION,
        run_id: runId,
        measurement_count: 0,
        diff_count: 0,
        api_provider_called: false,
        database_modified: false,
        preview: [],
      });
    }

    const measurementIds = measurements.map((row) => String(row.id));
    const { data: mentionRows, error: mentionError } = await client
      .from("measurement_mentions")
      .select("measurement_id,matched_business_id,display_name,count_as_confirmed_business")
      .eq("org_id", orgId)
      .in("measurement_id", measurementIds);
    if (mentionError) throw new AppError(500, "MENTIONS_LOAD_FAILED");

    const v1ByMeasurement = new Map<string, EntityV1ResolutionForShadow[]>();
    for (const row of (mentionRows ?? []) as Record<string, unknown>[]) {
      const measurementId = String(row.measurement_id);
      const current = v1ByMeasurement.get(measurementId) ?? [];
      current.push({
        displayName: typeof row.display_name === "string" ? row.display_name : "",
        matchedBusinessId:
          typeof row.matched_business_id === "string" ? row.matched_business_id : null,
        countAsConfirmedBusiness: row.count_as_confirmed_business === true,
      });
      v1ByMeasurement.set(measurementId, current);
    }

    const preview = measurements.map((measurement) => {
      const measurementId = String(measurement.id);
      const responseText = typeof measurement.response_text === "string"
        ? measurement.response_text
        : "";
      const comparison = runEntityV2RuntimeShadowComparison({
        responseText,
        businesses,
        v1Resolutions: v1ByMeasurement.get(measurementId) ?? [],
      });
      return {
        measurement_id: measurementId,
        parser_version:
          typeof measurement.parser_version === "string" ? measurement.parser_version : null,
        valid: measurement.valid === true,
        ...comparison,
      };
    });

    const diffCount = preview.filter((item) => !item.match).length;
    const mismatchCount = preview.reduce((sum, item) => sum + item.mismatchCount, 0);
    const registeredV1Only = preview.reduce(
      (sum, item) => sum + item.registeredBusinesses.v1Only.length,
      0,
    );
    const registeredV2Only = preview.reduce(
      (sum, item) => sum + item.registeredBusinesses.v2Only.length,
      0,
    );
    const unregisteredV1Only = preview.reduce(
      (sum, item) => sum + item.unregisteredBusinesses.v1Only.length,
      0,
    );
    const unregisteredV2Only = preview.reduce(
      (sum, item) => sum + item.unregisteredBusinesses.v2Only.length,
      0,
    );

    console.info(JSON.stringify({
      function: "entity-v2-shadow-preview",
      run_id: runId,
      org_id: orgId,
      measurement_count: preview.length,
      diff_count: diffCount,
      mismatch_count: mismatchCount,
      api_provider_called: false,
      database_modified: false,
    }));

    return jsonResponse({
      ok: true,
      mode: "entity-v2-shadow-preview",
      version: ENTITY_V2_RUNTIME_SHADOW_VERSION,
      run_id: runId,
      org_id: orgId,
      business_id: businessId,
      measurement_count: preview.length,
      exact_match_count: preview.length - diffCount,
      diff_count: diffCount,
      mismatch_count: mismatchCount,
      registered_v1_only: registeredV1Only,
      registered_v2_only: registeredV2Only,
      unregistered_v1_only: unregisteredV1Only,
      unregistered_v2_only: unregisteredV2Only,
      api_provider_called: false,
      database_modified: false,
      preview,
    });
  } catch (error) {
    const status = error instanceof AppError ? error.status : 500;
    const code = error instanceof AppError ? error.code : "INTERNAL_ERROR";
    console.error(JSON.stringify({
      function: "entity-v2-shadow-preview",
      code,
      message: safeMessage(error),
    }));
    return jsonResponse({ ok: false, error: code }, status);
  }
});
