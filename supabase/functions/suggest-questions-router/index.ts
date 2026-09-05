import { createClient } from "jsr:@supabase/supabase-js@2";
import { generateMarketSuggestions, type MarketBusiness } from "./market-generator.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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
    const p = JSON.parse(raw) as Record<string, unknown>;
    if (typeof p?.default === "string" && p.default.trim()) return p.default.trim();
    for (const v of Object.values(p ?? {})) {
      if (typeof v === "string" && v.trim()) return v.trim();
    }
  } catch {}
  return;
}

function rec(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }
  if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);

  try {
    const auth = req.headers.get("Authorization") ?? "";
    if (!auth.startsWith("Bearer ")) return json({ error: "UNAUTHORIZED" }, 401);

    const url = Deno.env.get("SUPABASE_URL")?.trim() ?? "";
    const pub =
      readDefaultKey("SUPABASE_PUBLISHABLE_KEYS") ??
      Deno.env.get("SUPABASE_PUBLISHABLE_KEY")?.trim() ??
      Deno.env.get("SUPABASE_ANON_KEY")?.trim() ??
      "";
    const secret =
      readDefaultKey("SUPABASE_SECRET_KEYS") ??
      Deno.env.get("SUPABASE_SECRET_KEY")?.trim() ??
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim() ??
      "";
    const openai = Deno.env.get("OPENAI_API_KEY")?.trim() ?? "";

    if (!url || !pub || !secret) return json({ error: "SERVER_NOT_CONFIGURED" }, 500);

    const userClient = createClient(url, pub, {
      global: { headers: { Authorization: auth } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const admin = createClient(url, secret, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) return json({ error: "UNAUTHORIZED" }, 401);

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const orgId = typeof body?.orgId === "string" ? body.orgId : "";
    const businessId = typeof body?.businessId === "string" ? body.businessId : "";
    const count = Number(body?.count ?? 24);

    if (!orgId || !businessId || count !== 24) return json({ error: "INVALID_INPUT" }, 400);

    const { data: membership, error: memErr } = await userClient
      .from("organization_members")
      .select("role")
      .eq("org_id", orgId)
      .eq("user_id", userData.user.id)
      .maybeSingle();

    if (memErr) return json({ error: "MEMBERSHIP_CHECK_FAILED" }, 500);
    if (!membership || !["owner", "admin", "analyst"].includes(String(membership.role))) {
      return json({ error: "FORBIDDEN" }, 403);
    }

    const { data: flagRaw, error: flagErr } = await admin.rpc(
      "get_measurement_market_feature_flag_v01",
      { p_org_id: orgId },
    );
    if (flagErr) return json({ error: "FEATURE_FLAG_CHECK_FAILED" }, 500);

    const flag = rec(flagRaw);
    const usePilot =
      flag?.enabled === true &&
      flag?.rolloutStage === "internal_pilot" &&
      flag?.internalPilotAllowed === true;

    if (!usePilot) {
      const forwarded = await fetch(`${url}/functions/v1/suggest-questions`, {
        method: "POST",
        headers: {
          Authorization: auth,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ orgId, businessId, count: 24 }),
      });

      const payload = (await forwarded.json().catch(() => ({}))) as Record<string, unknown>;
      if (!forwarded.ok) {
        return json(
          {
            error:
              typeof payload.error === "string"
                ? payload.error
                : "QUESTION_GENERATION_FAILED",
          },
          forwarded.status,
        );
      }

      const suggestions = Array.isArray(payload.suggestions) ? payload.suggestions : [];
      return json({
        suggestions,
        requestedCount: 24,
        suggestionCount: suggestions.length,
      });
    }

    if (!openai) return json({ error: "SERVER_NOT_CONFIGURED" }, 500);

    const { data: biz, error: bizErr } = await admin
      .from("businesses")
      .select("id,name,country_code,region,city,is_client_business,active")
      .eq("id", businessId)
      .eq("org_id", orgId)
      .eq("is_client_business", true)
      .eq("active", true)
      .maybeSingle();

    if (bizErr || !biz) return json({ error: "BUSINESS_NOT_AVAILABLE" }, 404);

    try {
      const result = await generateMarketSuggestions(
        admin,
        openai,
        orgId,
        biz as MarketBusiness,
      );
      return json({
        suggestions: result.suggestions,
        requestedCount: 24,
        suggestionCount: result.suggestions.length,
      });
    } catch (e) {
      return json(
        { error: e instanceof Error ? e.message : "MARKET_GENERATION_FAILED" },
        502,
      );
    }
  } catch {
    return json({ error: "INTERNAL_ERROR" }, 500);
  }
});
