import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LEGACY_FUNCTION = "visibility-action-recommendations";
const LEGACY_SOURCE_ID = "source:dedicated_site_candidate:trust";
const LEGACY_GROUP_KEY = "dedicated_site_candidate";
const MARKET_GROUP_KEY = "business_brand_site";
const PRELIMINARY_SITE_LABEL = "여러 답변에서 연결";
const FILTER_VERSION = "0.2";

type Obj = Record<string, unknown>;
type SharednessRow = {
  domain: string;
  distinct_entity_keys: number;
  target_business_contexts: number;
  linked_response_count: number;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...cors,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function isObj(v: unknown): v is Obj {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function readKey(name: string) {
  const raw = Deno.env.get(name)?.trim();
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isObj(parsed)) return undefined;
    if (typeof parsed.default === "string" && parsed.default.trim()) return parsed.default.trim();
    for (const value of Object.values(parsed)) {
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  } catch {}
  return undefined;
}

function env() {
  return {
    url: Deno.env.get("SUPABASE_URL")?.trim() || "",
    secret:
      readKey("SUPABASE_SECRET_KEYS") ??
      Deno.env.get("SUPABASE_SECRET_KEY")?.trim() ??
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim() ??
      "",
  };
}

function n(v: unknown, fallback = 0) {
  const value = Number(v);
  return Number.isFinite(value) ? value : fallback;
}

function normDomain(v: unknown) {
  return (typeof v === "string" ? v.trim().toLowerCase() : "").replace(/^www\./, "");
}

function hasLegacyHomepageGroup(rec: unknown) {
  if (!isObj(rec)) return false;
  if (rec.id === LEGACY_SOURCE_ID) return true;
  const groups = Array.isArray(rec.sourceGroups) ? rec.sourceGroups : [];
  return groups.some((group) => isObj(group) && group.key === LEGACY_GROUP_KEY);
}

function homepageDomains(rec: unknown): string[] {
  if (!isObj(rec)) return [];
  const out = new Set<string>();
  const groups = Array.isArray(rec.sourceGroups) ? rec.sourceGroups : [];
  for (const group of groups) {
    if (!isObj(group) || group.key !== LEGACY_GROUP_KEY) continue;
    const platforms = Array.isArray(group.platforms) ? group.platforms : [];
    for (const platform of platforms) {
      if (!isObj(platform)) continue;
      const domains = Array.isArray(platform.domains) ? platform.domains : [];
      for (const raw of domains) {
        const domain = normDomain(raw);
        if (domain) out.add(domain);
      }
    }
  }
  return [...out];
}

function isSharedThirdPartyDomain(row: SharednessRow | undefined) {
  if (!row) return true;
  const entities = n(row.distinct_entity_keys);
  const contexts = n(row.target_business_contexts);
  // Precision-first: a domain seen with 3+ entity keys, or with multiple entity keys
  // across multiple target-business measurement contexts, behaves like a shared
  // information/directory surface rather than one business's dedicated site.
  return entities >= 3 || (entities >= 2 && contexts >= 2);
}

function marketSentence(data: unknown) {
  if (!isObj(data)) return null;
  const groups = Array.isArray(data.sourceGroups) ? data.sourceGroups : [];
  const group = groups.find((g) => isObj(g) && g.key === MARKET_GROUP_KEY);
  const meta = isObj(data.benchmark) ? data.benchmark : {};
  if (!group || !isObj(group)) return null;
  const total = n(meta.highVisibilityEntityCount);
  const count = n(group.highEntityCount);
  const days = n(meta.windowDays, 90);
  const share = n(group.highEntitySharePct, Number.NaN);
  if (total <= 0 || count <= 0) return null;
  const shareText = Number.isFinite(share) ? `(${share.toFixed(1)}%)` : "";
  const label =
    typeof group.label === "string" && group.label.trim()
      ? group.label.trim()
      : "업체·브랜드 홈페이지·독립 사이트";
  return `참고로 최근 ${days}일 누적 자동차 측정의 익명 집계에서는 ${label} 계열이 고노출 업체 ${total}곳 중 ${count}곳${shareText}에서 관찰됐습니다.`;
}

function preliminaryText(v: unknown, repetitions: number) {
  if (typeof v !== "string" || repetitions >= 2) return v;
  return v
    .replace(/여러 답변에서 반복 연결됐지만/g, "여러 답변에서 연결됐지만")
    .replace(/반복 연결되는/g, "여러 답변에서 연결되는")
    .replace(/특정 업체와 반복 연결된 독립 사이트/g, "특정 업체와 여러 답변에서 연결된 독립 사이트");
}

function preliminaryEvidenceLabel(v: unknown, repetitions: number) {
  return repetitions < 2 && v === "독립 사이트 반복 관찰" ? PRELIMINARY_SITE_LABEL : v;
}

function enrichHomepageRecommendation(rec: unknown, marketText: string | null, repetitions: number) {
  if (!isObj(rec) || !hasLegacyHomepageGroup(rec)) return rec;
  const rawSummary = typeof rec.summary === "string" ? rec.summary : "";
  const summary = String(preliminaryText(rawSummary, repetitions) ?? "");
  const sourceGroups = Array.isArray(rec.sourceGroups)
    ? rec.sourceGroups.map((group) => {
        if (!isObj(group) || group.key !== LEGACY_GROUP_KEY) return group;
        const platforms = Array.isArray(group.platforms)
          ? group.platforms.map((platform) =>
              isObj(platform)
                ? { ...platform, evidenceLabel: preliminaryEvidenceLabel(platform.evidenceLabel, repetitions) }
                : platform,
            )
          : group.platforms;
        return {
          ...group,
          name: preliminaryText(group.name, repetitions),
          reason: preliminaryText(group.reason, repetitions),
          evidenceLabel: preliminaryEvidenceLabel(group.evidenceLabel, repetitions),
          platforms,
        };
      })
    : rec.sourceGroups;

  const nextSummary =
    marketText && !summary.includes(marketText)
      ? `${summary}${summary ? " " : ""}${marketText}`
      : summary;
  return { ...rec, summary: nextSummary, sourceGroups };
}

function recommendationScore(rec: unknown) {
  if (!isObj(rec)) return 0;
  const evidence = isObj(rec.evidence) ? rec.evidence : {};
  const competitor = n(evidence.competitorResponseCount);
  const client = n(evidence.clientResponseCount);
  const distinct = n(evidence.distinctCompetitorCount);
  const gap = Math.max(0, competitor - client);
  const kind = typeof rec.kind === "string" ? rec.kind : "";
  const level = typeof rec.evidenceLevel === "string" ? rec.evidenceLevel : "";

  let score = kind === "source_gap" ? 1000 : 600;
  if (level === "priority_try") score += 400;
  else if (level === "worth_review") score += 200;
  score += gap * 40 + distinct * 60 + competitor * 20;
  return score;
}

function rerank(recommendations: unknown[]) {
  return [...recommendations]
    .sort((a, b) => recommendationScore(b) - recommendationScore(a))
    .map((rec, index) => (isObj(rec) ? { ...rec, rank: index + 1 } : rec));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);

  const auth = req.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return json({ ok: false, error: "UNAUTHORIZED" }, 401);
  const e = env();
  if (!e.url || !e.secret) return json({ ok: false, error: "SERVER_NOT_CONFIGURED" }, 500);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "INVALID_REQUEST" }, 400);
  }
  if (!isObj(body)) return json({ ok: false, error: "INVALID_REQUEST" }, 400);
  const orgId = typeof body.orgId === "string" ? body.orgId : "";
  const businessId = typeof body.businessId === "string" ? body.businessId : "";
  if (!UUID_RE.test(orgId) || !UUID_RE.test(businessId)) {
    return json({ ok: false, error: "INVALID_REQUEST" }, 400);
  }

  let baseResp: Response;
  try {
    baseResp = await fetch(`${e.url}/functions/v1/${LEGACY_FUNCTION}`, {
      method: "POST",
      headers: {
        authorization: auth,
        apikey: e.secret,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ orgId, businessId }),
    });
  } catch (err) {
    console.error(
      JSON.stringify({
        function: "visibility-action-recommendations-v2",
        code: "LEGACY_FETCH_FAILED",
        message: err instanceof Error ? err.message : String(err),
      }),
    );
    return json({ ok: false, error: "INTERNAL_ERROR" }, 500);
  }

  let basePayload: unknown;
  try {
    basePayload = await baseResp.json();
  } catch {
    return json({ ok: false, error: "INTERNAL_ERROR" }, 500);
  }
  if (!baseResp.ok || !isObj(basePayload) || basePayload.ok !== true) {
    return json(basePayload, baseResp.status);
  }

  const repetitions = isObj(basePayload.scope) ? n(basePayload.scope.repetitions) : 0;
  const db = createClient(e.url, e.secret, { auth: { persistSession: false, autoRefreshToken: false } });
  let recommendations = Array.isArray(basePayload.recommendations) ? [...basePayload.recommendations] : [];

  // First-run intent-only gaps are observations, not top execution recommendations.
  // The dashboard already exposes these gaps in question-group / missed-question sections.
  if (repetitions < 2) {
    recommendations = recommendations.filter(
      (rec) => !(isObj(rec) && rec.kind === "intent_gap"),
    );
  }

  const homepageRecs = recommendations.filter(hasLegacyHomepageGroup);
  let homepageAllowed = homepageRecs.length === 0;
  if (homepageRecs.length > 0) {
    const domains = [...new Set(homepageRecs.flatMap(homepageDomains))];
    if (domains.length > 0) {
      const { data: sharedness, error: sharednessError } = await db.rpc(
        "get_visibility_domain_sharedness_v01",
        { p_domains: domains },
      );
      if (sharednessError) {
        console.error(
          JSON.stringify({
            function: "visibility-action-recommendations-v2",
            code: "DOMAIN_SHAREDNESS_RPC_FAILED",
            message: sharednessError.message,
          }),
        );
        homepageAllowed = false;
      } else {
        const byDomain = new Map<string, SharednessRow>();
        for (const raw of Array.isArray(sharedness) ? sharedness : []) {
          if (!isObj(raw)) continue;
          const domain = normDomain(raw.domain);
          if (!domain) continue;
          byDomain.set(domain, {
            domain,
            distinct_entity_keys: n(raw.distinct_entity_keys),
            target_business_contexts: n(raw.target_business_contexts),
            linked_response_count: n(raw.linked_response_count),
          });
        }
        // Precision-first: every domain supporting a homepage action must look dedicated.
        homepageAllowed = domains.every((domain) => !isSharedThirdPartyDomain(byDomain.get(domain)));
      }
    }

    if (!homepageAllowed) {
      recommendations = recommendations.filter((rec) => !hasLegacyHomepageGroup(rec));
    }
  }

  let marketText: string | null = null;
  if (homepageAllowed && recommendations.some(hasLegacyHomepageGroup)) {
    const { data: benchmark, error: benchmarkError } = await db.rpc(
      "get_global_high_visibility_source_patterns_v02",
      { p_requesting_org_id: orgId, p_business_id: businessId },
    );
    if (benchmarkError) {
      console.error(
        JSON.stringify({
          function: "visibility-action-recommendations-v2",
          code: "BENCHMARK_RPC_FAILED",
          message: benchmarkError.message,
        }),
      );
    } else {
      marketText = marketSentence(benchmark);
    }
  }

  recommendations = recommendations.map((rec) =>
    enrichHomepageRecommendation(rec, marketText, repetitions),
  );
  recommendations = rerank(recommendations);

  const disclaimer =
    repetitions < 2
      ? "현재는 동일 조건 1회 측정의 1차 관찰입니다. 상위 액션에는 실제 출처 연결 차이가 확인된 항목만 표시하고, 질문군별 미노출은 추가 관찰 영역으로 분리합니다. 질문군이나 출처가 추천 원인이라는 뜻은 아니며, 동일 질문 세트로 재측정해 반복성을 확인해야 합니다."
      : basePayload.disclaimer;

  return json({
    ...basePayload,
    recommendations,
    disclaimer,
    recommendationFilterVersion: FILTER_VERSION,
  });
});