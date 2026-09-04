import { createClient } from "jsr:@supabase/supabase-js@2";

type Slot = {
  position: number;
  intentType: string;
  intentLabel: string;
  marketLayer: string;
  marketLayerLabel: string;
  locationScope: string;
  locationSurface: string;
  serviceKey: string;
  serviceLabel: string;
  serviceEvidenceStatus?: string | null;
};

type Suggestion = { position: number; prompt_text: string };

const MODEL = "gpt-5.6-luna";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function readDefaultKey(name: string): string | undefined {
  const raw = Deno.env.get(name)?.trim();
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;
    const dict = parsed as Record<string, unknown>;
    if (typeof dict.default === "string" && dict.default.trim()) return dict.default.trim();
    for (const value of Object.values(dict)) if (typeof value === "string" && value.trim()) return value.trim();
  } catch {}
  return;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function compact(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("ko-KR").replace(/[^\p{L}\p{N}]+/gu, "");
}

function extractOutputText(payload: Record<string, unknown>): string {
  if (typeof payload.output_text === "string") return payload.output_text;
  const parts: string[] = [];
  for (const item of Array.isArray(payload.output) ? payload.output : []) {
    const rec = asRecord(item);
    for (const content of Array.isArray(rec?.content) ? rec.content : []) {
      const c = asRecord(content);
      if (typeof c?.text === "string") parts.push(c.text);
      const t = asRecord(c?.text);
      if (typeof t?.value === "string") parts.push(t.value);
    }
  }
  return parts.join("\n");
}

function serviceAnchors(key: string): string[] {
  const map: Record<string, string[]> = {
    engine_oil: ["엔진오일", "오일교환", "오일 교환"],
    premium_lubricant: ["윤활유", "합성유", "프리미엄 오일", "프리미엄오일"],
    tire: ["타이어"], wheel: ["휠"], tinting: ["썬팅", "틴팅"],
    new_car_package: ["신차패키지", "신차 패키지"], ppf: ["PPF", "페인트 프로텍션"],
    wrapping: ["랩핑", "래핑", "wrapping"], tuning: ["튜닝"],
    electrical: ["전장", "블랙박스", "하이패스", "카오디오", "보조배터리"],
    detailing: ["디테일링"], car_wash: ["세차"], coating: ["코팅", "유리막", "세라믹"],
    dent: ["덴트"], battery: ["배터리"], brake: ["브레이크"], suspension: ["서스펜션", "쇼바"],
    rent_car: ["렌터카", "렌트카"], general_repair: ["정비", "카센터", "공업사"],
  };
  return map[key] ?? [];
}

function isValidSuggestion(slot: Slot, prompt: string, businessName: string): boolean {
  const text = prompt.normalize("NFKC").replace(/\s+/g, " ").trim();
  if (text.length < 8 || text.length > 180) return false;
  if (compact(text).includes(compact(businessName))) return false;
  if (slot.locationSurface && !compact(text).includes(compact(slot.locationSurface))) return false;
  const anchors = serviceAnchors(slot.serviceKey);
  if (anchors.length && !anchors.some((a) => compact(text).includes(compact(a)))) return false;
  return true;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "UNAUTHORIZED" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim() ?? "";
  const publishableKey = readDefaultKey("SUPABASE_PUBLISHABLE_KEYS") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY")?.trim() ?? Deno.env.get("SUPABASE_ANON_KEY")?.trim() ?? "";
  const secretKey = readDefaultKey("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SECRET_KEY")?.trim() ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim() ?? "";
  const openaiKey = Deno.env.get("OPENAI_API_KEY")?.trim() ?? "";
  if (!supabaseUrl || !publishableKey || !secretKey || !openaiKey) return json({ error: "SERVER_NOT_CONFIGURED" }, 500);

  const userClient = createClient(supabaseUrl, publishableKey, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false, autoRefreshToken: false } });
  const admin = createClient(supabaseUrl, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) return json({ error: "UNAUTHORIZED" }, 401);

  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  const orgId = typeof body?.orgId === "string" ? body.orgId : "";
  const businessId = typeof body?.businessId === "string" ? body.businessId : "";
  if (!orgId || !businessId) return json({ error: "INVALID_INPUT" }, 400);

  const { data: adminAllowed, error: adminError } = await userClient.rpc("can_view_data_asset_admin_v01");
  if (adminError || adminAllowed !== true) return json({ error: "FORBIDDEN" }, 403);

  const { data: business, error: businessError } = await admin.from("businesses").select("id,org_id,name,is_client_business,active").eq("id", businessId).eq("org_id", orgId).eq("is_client_business", true).eq("active", true).maybeSingle();
  if (businessError || !business) return json({ error: "BUSINESS_NOT_AVAILABLE" }, 404);

  const { data: portfolioRaw, error: portfolioError } = await admin.rpc("build_measurement_market_portfolio_candidate_v02", { p_business_id: businessId });
  if (portfolioError) return json({ error: "PORTFOLIO_FAILED" }, 500);
  const portfolio = asRecord(portfolioRaw);
  if (!portfolio || portfolio.status !== "READY_SHADOW" || !Array.isArray(portfolio.slots) || portfolio.slots.length !== 24) return json({ error: "PORTFOLIO_NOT_READY" }, 409);

  const slots: Slot[] = [];
  for (const value of portfolio.slots) {
    const slot = asRecord(value);
    if (!slot) return json({ error: "PORTFOLIO_INVALID" }, 500);
    const parsed: Slot = {
      position: Number(slot.position), intentType: String(slot.intentType ?? ""), intentLabel: String(slot.intentLabel ?? ""),
      marketLayer: String(slot.marketLayer ?? ""), marketLayerLabel: String(slot.marketLayerLabel ?? ""),
      locationScope: String(slot.locationScope ?? ""), locationSurface: String(slot.locationSurface ?? ""),
      serviceKey: String(slot.serviceKey ?? ""), serviceLabel: String(slot.serviceLabel ?? ""),
      serviceEvidenceStatus: slot.serviceEvidenceStatus == null ? null : String(slot.serviceEvidenceStatus),
    };
    if (!Number.isInteger(parsed.position) || !parsed.intentType || !parsed.locationSurface || !parsed.serviceKey || !parsed.serviceLabel) return json({ error: "PORTFOLIO_INVALID" }, 500);
    slots.push(parsed);
  }

  const schema = { type: "object", additionalProperties: false, properties: { suggestions: { type: "array", minItems: 24, maxItems: 24, items: { type: "object", additionalProperties: false, properties: { position: { type: "integer", minimum: 1, maximum: 24 }, prompt_text: { type: "string", minLength: 8, maxLength: 180 } }, required: ["position", "prompt_text"] } } }, required: ["suggestions"] };
  const system = [
    "You are naturalizing a fixed market-measurement question portfolio for Korean automotive local businesses.",
    "Do not change the market being measured. Each output must preserve the supplied slot's intent, service, and location.",
    "Write the way an ordinary Korean consumer would realistically ask ChatGPT or search AI for actual businesses.",
    "Never mention or hint at the target business name. Do not optimize for the target business to appear and do not intentionally suppress it.",
    "Every question must be independently understandable and likely to produce actual provider/business names.",
    "Use the supplied location surface explicitly and stay inside that location boundary.",
    "Use natural service wording. For premium_lubricant, use natural expressions such as 프리미엄 엔진오일, 합성유, 윤활유 전문점 instead of mechanically copying a taxonomy label.",
    "For general_repair, use ordinary phrases such as 자동차 정비소, 정비 업체, 카센터. For tinting use 썬팅 naturally; for wrapping use 랩핑 or 래핑; for new_car_package use 신차패키지.",
    "Keep the eight intent meanings distinct: local, recommendation, service, review_quality, trust, comparison, price_value, discovery.",
    "Avoid analytical wording, invented facts, exact prices, fake review claims, guarantees, or causal statements.",
    "Vary Korean endings and sentence shapes so the 24 questions do not look templated, while preserving each slot exactly. Return JSON only and preserve every supplied position exactly once.",
  ].join(" ");

  const response = await fetch("https://api.openai.com/v1/responses", { method: "POST", headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: MODEL, store: false, input: [{ role: "system", content: system }, { role: "user", content: JSON.stringify({ target_business_name_for_exclusion_only: business.name, slots }) }], reasoning: { effort: "low" }, max_output_tokens: 3500, text: { format: { type: "json_schema", name: "market_shadow_questions_v02", strict: true, schema } } }) });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) return json({ error: "AI_GENERATION_FAILED" }, 502);

  let parsed: unknown;
  try { parsed = JSON.parse(extractOutputText(payload)); } catch { return json({ error: "AI_OUTPUT_INVALID" }, 502); }
  const rec = asRecord(parsed);
  const rawSuggestions = Array.isArray(rec?.suggestions) ? rec!.suggestions as unknown[] : [];
  if (rawSuggestions.length !== 24) return json({ error: "AI_OUTPUT_INVALID" }, 502);

  const byPosition = new Map<number, Suggestion>();
  for (const raw of rawSuggestions) {
    const s = asRecord(raw);
    const position = Number(s?.position);
    const prompt = typeof s?.prompt_text === "string" ? s.prompt_text.replace(/\s+/g, " ").trim() : "";
    if (!Number.isInteger(position) || position < 1 || position > 24 || byPosition.has(position)) return json({ error: "AI_OUTPUT_INVALID" }, 502);
    const slot = slots.find((x) => x.position === position);
    if (!slot || !isValidSuggestion(slot, prompt, String(business.name))) return json({ error: "AI_OUTPUT_VALIDATION_FAILED", position }, 502);
    byPosition.set(position, { position, prompt_text: prompt });
  }

  const usage = asRecord(payload.usage);
  const inputTokens = Number(usage?.input_tokens ?? 0) || 0;
  const outputTokens = Number(usage?.output_tokens ?? 0) || 0;
  await admin.from("cost_events").insert({ org_id: orgId, provider: "openai", model: MODEL, amount_usd: 0, input_tokens: inputTokens || null, output_tokens: outputTokens || null, metadata: { cost_source: "unpriced_usage", pricing_status: "not_yet_priced", feature: "measurement_market_shadow_question_naturalizer_v0_2", business_id: businessId, question_count: 24, persisted_to_live_questions: false } });

  const suggestions = slots.sort((a, b) => a.position - b.position).map((slot) => ({ ...slot, promptText: byPosition.get(slot.position)!.prompt_text }));
  return json({ ok: true, mode: "measurement_market_shadow_v0_2", model: MODEL, persisted: false, liveGeneratorConnected: false, portfolioVersion: String(portfolio.version ?? "0.2"), suggestions, usage: { inputTokens, outputTokens } });
});
