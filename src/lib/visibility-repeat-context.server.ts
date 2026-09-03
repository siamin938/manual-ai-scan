/**
 * 반복 측정(compatible run) 보조 컨텍스트 조회.
 *
 * - compatible run 판정은 기존 공용 RPC `get_compatible_audit_runs_v01`만 사용한다.
 * - significant competitor 판정은 기존 공용 RPC `get_competitor_significance_v01`의
 *   tier(core/notable) 결과를 그대로 사용한다. 여기서 새 점수/threshold를 만들지 않는다.
 * - 모든 조회는 현재 사용자 JWT 기반 클라이언트(RLS)로 수행한다.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  normalizeDomain,
  repeatQuestionState,
  resolveSourceSide,
  sortRepeatQuestions,
} from "./visibility-repeat-context.helpers";
import type {
  RepeatContextQuestionDTO,
  RepeatContextSourceDTO,
  VisibilityRepeatContextResponseDTO,
} from "./visibility-repeat-context.types";

type DbClient = SupabaseClient<Database>;

const MAX_COMPATIBLE_RUNS = 6;
const SIGNIFICANT_TIERS = new Set(["core", "notable"]);

type AttributionRow = {
  measurement_id: string;
  source_run_id: string;
  canonical_key: string;
  domain: string | null;
};

/**
 * actionable view만 사용한다. 조회 실패 시 null을 반환해 fail-closed 처리한다.
 * base attribution row로 대체하면 기존 actionable 정책을 우회하게 되므로 하지 않는다.
 */
async function loadAttributionRows(
  supabase: DbClient,
  orgId: string,
  businessId: string,
  runIds: string[],
): Promise<AttributionRow[] | null> {
  const viewResult = await supabase
    .from("measurement_citation_attributions_actionable_v2")
    .select("measurement_id, source_run_id, canonical_key, domain")
    .eq("org_id", orgId)
    .eq("business_id", businessId)
    .in("source_run_id", runIds);

  if (viewResult.error || !viewResult.data) {
    console.error("[visibility-repeat-context] actionable attribution view unavailable");
    return null;
  }
  return viewResult.data as AttributionRow[];
}

export async function fetchVisibilityRepeatContext(args: {
  supabase: DbClient;
  orgId: string;
  businessId: string;
}): Promise<VisibilityRepeatContextResponseDTO> {
  const { supabase, orgId, businessId } = args;

  // 조직 격리: 현재 사용자가 접근 가능한 org의 업체인지 RLS로 확인한다.
  const businessCheck = await supabase
    .from("businesses")
    .select("id")
    .eq("id", businessId)
    .eq("org_id", orgId)
    .eq("is_client_business", true)
    .eq("active", true)
    .maybeSingle();
  if (businessCheck.error) return { ok: false, error: "NOT_AVAILABLE" };
  if (!businessCheck.data) return { ok: false, error: "FORBIDDEN" };

  // scope 확인 통과 후에만 서버 전용 read-only 조회에 admin client를 사용한다.
  // (compatible-runs / significance RPC는 authenticated role에 EXECUTE 권한이 없다.)
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as unknown as DbClient;

  // 서버 환경변수 누락 등으로 admin client 생성이 실패하면 화면을 깨지 않고 fail-closed한다.
  let runsResult;
  try {
    runsResult = await db.rpc("get_compatible_audit_runs_v01", {
      p_org_id: orgId,
      p_business_id: businessId,
      p_limit: MAX_COMPATIBLE_RUNS,
    });
  } catch {
    console.error("[visibility-repeat-context] server client unavailable");
    return { ok: false, error: "NOT_AVAILABLE" };
  }
  if (runsResult.error) {
    console.error("[visibility-repeat-context] compatible runs RPC failed");
    return { ok: false, error: "NOT_AVAILABLE" };
  }

  const runIds = (runsResult.data ?? [])
    .map((row) => row.run_id)
    .filter((id): id is string => typeof id === "string");

  if (runIds.length === 0) {
    return { ok: true, context: { compatibleRunCount: 0, sources: [], questions: [] } };
  }

  const measurementsResult = await db
    .from("measurements")
    .select("id, run_id, question_id, was_client_mentioned")
    .eq("org_id", orgId)
    .in("run_id", runIds)
    .eq("valid", true);
  if (measurementsResult.error) return { ok: false, error: "NOT_AVAILABLE" };

  const validMeasurementIds = new Set<string>();
  const perQuestion = new Map<string, { validCount: number; mentionCount: number }>();
  for (const m of measurementsResult.data ?? []) {
    validMeasurementIds.add(m.id);
    const bucket = perQuestion.get(m.question_id) ?? { validCount: 0, mentionCount: 0 };
    bucket.validCount += 1;
    if (m.was_client_mentioned) bucket.mentionCount += 1;
    perQuestion.set(m.question_id, bucket);
  }

  // significant competitor canonical key (run별)
  const significantByRun = new Map<string, Set<string>>();
  for (const runId of runIds) {
    const sig = await db.rpc("get_competitor_significance_v01", {
      p_org_id: orgId,
      p_business_id: businessId,
      p_run_id: runId,
    });
    const keys = new Set<string>();
    if (sig.error) {
      // competitor evidence가 빠지면 source side가 잘못 표시되므로 fail-closed.
      console.error("[visibility-repeat-context] competitor significance RPC failed");
      return { ok: false, error: "NOT_AVAILABLE" };
    }
    for (const row of sig.data ?? []) {
      if (typeof row.canonical_key === "string" && SIGNIFICANT_TIERS.has(row.tier ?? "")) {
        keys.add(row.canonical_key);
      }
    }
    significantByRun.set(runId, keys);
  }

  const clientKey = `business:${businessId}`;
  const rows = await loadAttributionRows(db, orgId, businessId, runIds);
  if (rows === null) return { ok: false, error: "NOT_AVAILABLE" };

  type Bucket = { client: Set<string>; competitor: Set<string> };
  const byDomain = new Map<string, Bucket>();
  for (const row of rows) {
    if (!validMeasurementIds.has(row.measurement_id)) continue;
    const domain = normalizeDomain(row.domain);
    if (!domain) continue;

    const isClient = row.canonical_key === clientKey;
    const isCompetitor =
      !isClient && (significantByRun.get(row.source_run_id)?.has(row.canonical_key) ?? false);
    if (!isClient && !isCompetitor) continue;

    let bucket = byDomain.get(domain);
    if (!bucket) {
      bucket = { client: new Set(), competitor: new Set() };
      byDomain.set(domain, bucket);
    }
    if (isClient) bucket.client.add(row.measurement_id);
    else bucket.competitor.add(row.measurement_id);
  }

  const sources: RepeatContextSourceDTO[] = [];
  for (const [domain, bucket] of byDomain) {
    const side = resolveSourceSide(bucket.client.size, bucket.competitor.size);
    if (!side) continue;
    sources.push({
      domain,
      clientResponseCount: bucket.client.size,
      competitorResponseCount: bucket.competitor.size,
      side,
    });
  }

  const weakQuestionIds = Array.from(perQuestion.entries())
    .filter(([, v]) => repeatQuestionState(v.validCount, v.mentionCount) !== "always_visible")
    .map(([id]) => id);

  let questions: RepeatContextQuestionDTO[] = [];
  if (weakQuestionIds.length > 0) {
    const questionsResult = await db
      .from("questions")
      .select("id, prompt_text, intent_type")
      .eq("org_id", orgId)
      .in("id", weakQuestionIds);
    if (questionsResult.error) return { ok: false, error: "NOT_AVAILABLE" };

    questions = (questionsResult.data ?? []).map((q) => {
      const agg = perQuestion.get(q.id) ?? { validCount: 0, mentionCount: 0 };
      return {
        questionId: q.id,
        questionText: q.prompt_text,
        intentType: q.intent_type,
        validCount: agg.validCount,
        mentionCount: agg.mentionCount,
        state: repeatQuestionState(agg.validCount, agg.mentionCount),
      };
    });
  }

  return {
    ok: true,
    context: {
      compatibleRunCount: runIds.length,
      sources,
      questions: sortRepeatQuestions(questions),
    },
  };
}
