import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,62}$/;
type Obj = Record<string, unknown>;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}
function isObj(v: unknown): v is Obj { return !!v && typeof v === "object" && !Array.isArray(v); }
function readSecret(name: string): string | undefined {
  const raw = Deno.env.get(name)?.trim();
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isObj(parsed)) return undefined;
    if (typeof parsed.default === "string" && parsed.default.trim()) return parsed.default.trim();
    for (const value of Object.values(parsed)) if (typeof value === "string" && value.trim()) return value.trim();
  } catch { return raw; }
  return undefined;
}
function env() {
  return {
    url: Deno.env.get("SUPABASE_URL")?.trim() || "",
    secret: readSecret("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SECRET_KEY")?.trim() ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim() ?? "",
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);

  const auth = req.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return json({ ok: false, error: "UNAUTHORIZED" }, 401);
  const token = auth.slice(7).trim();
  if (!token) return json({ ok: false, error: "UNAUTHORIZED" }, 401);

  const e = env();
  if (!e.url || !e.secret) return json({ ok: false, error: "SERVER_NOT_CONFIGURED" }, 500);

  let body: unknown;
  try { body = await req.json(); } catch { return json({ ok: false, error: "INVALID_REQUEST" }, 400); }
  if (!isObj(body)) return json({ ok: false, error: "INVALID_REQUEST" }, 400);

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const slug = typeof body.slug === "string" ? body.slug.trim().toLowerCase() : "";
  if (name.length < 2 || name.length > 120 || !SLUG_RE.test(slug)) return json({ ok: false, error: "INVALID_REQUEST" }, 400);

  const admin = createClient(e.url, e.secret, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData.user) return json({ ok: false, error: "UNAUTHORIZED" }, 401);

  const { data, error } = await admin.rpc("create_organization_with_owner_server_v01", {
    p_user_id: userData.user.id,
    p_name: name,
    p_slug: slug,
  });

  if (error) {
    const message = error.message ?? "";
    if (message.includes("ALREADY_HAS_ORGANIZATION")) return json({ ok: false, error: "ALREADY_HAS_ORGANIZATION" }, 409);
    if (message.includes("INVALID_ORGANIZATION_NAME") || message.includes("INVALID_SLUG")) return json({ ok: false, error: "INVALID_REQUEST" }, 400);
    if (message.includes("SLUG_ALREADY_EXISTS")) return json({ ok: false, error: "SLUG_ALREADY_EXISTS" }, 409);
    console.error(JSON.stringify({ function: "create-organization-with-owner", code: "CREATE_ORG_RPC_FAILED", message }));
    return json({ ok: false, error: "INTERNAL_ERROR" }, 500);
  }

  if (typeof data !== "string") return json({ ok: false, error: "INTERNAL_ERROR" }, 500);
  return json({ ok: true, orgId: data });
});
