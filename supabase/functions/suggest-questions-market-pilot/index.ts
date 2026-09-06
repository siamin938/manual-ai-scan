import { createClient } from "jsr:@supabase/supabase-js@2";
import { ensureMarketPublicEvidence } from "../suggest-questions-router/public-evidence.ts";
import { generateMarketSuggestions, type MarketBusiness } from "../suggest-questions-router/market-generator.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });

function readDefaultKey(name: string): string | undefined {
  const raw = Deno.env.get(name)?.trim();
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed.default === "string" && parsed.default.trim()) return parsed.default.trim();
    for (const value of Object.values(parsed)) {
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  } catch {}
  return;
}

function rec(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const orgId = typeof body?.orgId === "string" ? body.orgId : "";
  const businessId = typeof body?.businessId === "string" ? body.businessId : "";
  const nonce = typeof body?.nonce === "string" ? body.nonce : "";
  const count = Number(body?.count ?? 24);

  if (!orgId || !businessId || nonce.length < 20 || count !== 24) {
    return json({ error: "INVALID_INPUT" }, 400);
  }

  const url = Deno.env.get("SUPABASE_URL")?.trim() ?? "";
  const secret =
    readDefaultKey("SUPABASE_SECRET_KEYS") ??
    Deno.env.get("SUPABASE_SECRET_KEY")?.trim() ??
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim() ??
    "";
  const openai = Deno.env.get("OPENAI_API_KEY")?.trim() ?? "";

  if (!url || !secret || !openai) return json({ error: "SERVER_NOT_CONFIGURED" }, 500);

  const admin = createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let pilotActive = false;
  try {
    const tokenHash = await sha256(nonce);
    const { data: consumed, error: nonceErr } = await admin.rpc(
      "consume_measurement_market_shadow_nonce_v01",
      { p_token_hash: tokenHash, p_org_id: orgId, p_business_id: businessId },
    );
    if (nonceErr || consumed !== true) return json({ error: "NONCE_INVALID_OR_EXPIRED" }, 403);

    const { data: flagRaw, error: flagErr } = await admin.rpc(
      "get_measurement_market_feature_flag_v01",
      { p_org_id: orgId },
    );
    const flag = rec(flagRaw);
    if (
      flagErr ||
      flag?.enabled !== true ||
      flag?.rolloutStage !== "internal_pilot" ||
      flag?.internalPilotAllowed !== true
    ) {
      return json({ error: "PILOT_NOT_ENABLED" }, 409);
    }
    pilotActive = true;

    const { data: business, error: bizErr } = await admin
      .from("businesses")
      .select("id,name,category,country_code,region,city,address,website_url,naver_place_url,google_maps_url,is_client_business,active")
      .eq("id", businessId)
      .eq("org_id", orgId)
      .eq("is_client_business", true)
      .eq("active", true)
      .maybeSingle();

    if (bizErr || !business) return json({ error: "BUSINESS_NOT_AVAILABLE" }, 404);

    const evidence = await ensureMarketPublicEvidence(admin, openai, orgId, business);
    if (!evidence.ready) {
      return json(
        {
          error: evidence.reason === "check_failed" || evidence.reason === "profile_unavailable"
            ? "PUBLIC_EVIDENCE_CHECK_FAILED"
            : "PUBLIC_EVIDENCE_NOT_FOUND",
          evidence,
          persisted: false,
          measurementRunCreated: false,
        },
        evidence.reason === "check_failed" || evidence.reason === "profile_unavailable" ? 502 : 422,
      );
    }

    const result = await generateMarketSuggestions(
      admin,
      openai,
      orgId,
      business as MarketBusiness,
    );

    return json({
      ok: true,
      mode: "measurement_market_internal_pilot_v0_1",
      suggestions: result.suggestions,
      suggestionCount: result.suggestions.length,
      intentCounts: result.intentCounts,
      repairAttempts: result.repairAttempts,
      portfolioVersion: result.portfolioVersion,
      persisted: false,
      measurementRunCreated: false,
    });
  } catch (error) {
    return json({
      error: error instanceof Error ? error.message : "PILOT_FAILED",
      persisted: false,
      measurementRunCreated: false,
    }, 502);
  } finally {
    if (pilotActive) {
      await admin
        .from("measurement_market_feature_flags")
        .update({ enabled: false, rollout_stage: "off", updated_at: new Date().toISOString() })
        .eq("org_id", orgId);
    }
  }
});
