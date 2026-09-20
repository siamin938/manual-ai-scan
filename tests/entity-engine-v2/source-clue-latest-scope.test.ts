import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { describe, it } from "vitest";

const edgePath = resolve("supabase/functions/visibility-action-recommendations-v2/index.ts");
const source = readFileSync(edgePath, "utf8").replace(/^import .*createClient.*;\n/, "");
const edgeCode = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const comparisonSource = readFileSync(
  resolve("src/lib/visibility-comparison.server.ts"),
  "utf8",
)
  .replace(/^import .*$/gm, "")
  .replace(/^export /gm, "");
const dtoSource =
  comparisonSource +
  "\n" +
  readFileSync(resolve("src/lib/visibility-actions.server.ts"), "utf8").replace(
    /^import \{ parseVisibilityComparison \}.*\n/m,
    "",
  );
const dtoCode = ts.transpileModule(dtoSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
// Exercise the existing display-only reducer without mounting React or issuing a request.
const uiSource = readFileSync(resolve("src/components/action-recommendations-section.tsx"), "utf8");
const displayCode = ts.transpileModule(uiSource.slice(
  uiSource.indexOf("/** evidenceLevel"), uiSource.indexOf("export function ActionRecommendationsSection"),
), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const ORG = "11111111-1111-4111-8111-111111111111";
const BUSINESS = "22222222-2222-4222-8222-222222222222";
const RUN = "33333333-3333-4333-8333-333333333333";
const olderRun = "44444444-4444-4444-8444-444444444444";
const latest = {
  id: RUN, name: "Latest completed audit", org_id: ORG, business_id: BUSINESS,
  run_type: "audit", phase: "standalone", status: "completed", experiment_id: null,
  completed_at: "2026-09-09T12:14:12Z", created_at: "2026-09-09T11:50:50Z",
};
const profile = {
  source_key: "mycle", source_name: "마이클", source_group_key: "managed_profile",
  competitor_response_count: 4, distinct_competitor_count: 2, intent_count: 4,
  question_count: 4, client_response_count: 0,
  linked_competitors: [
    { name: "Fixture A", url: "https://fixture.invalid/a" },
    { name: "Fixture B", url: "https://fixture.invalid/b" },
  ],
  domains: ["fixture.invalid"], sample_questions: ["Fixture question A", "Fixture question B"],
};
const content = {
  ...profile, source_key: "tistory", source_name: "티스토리", source_group_key: "content",
  competitor_response_count: 3, distinct_competitor_count: 1, intent_count: 3, question_count: 3,
};

type Options = {
  compatible?: unknown[];
  base?: Record<string, unknown>;
  baseStatus?: number;
  runs?: typeof latest[];
  validCount?: number;
  profiles?: unknown[];
  contents?: unknown[];
  independent?: unknown[];
  repeatIndependent?: unknown[];
  fail?: string;
};

async function execute(options: Options = {}) {
  const calls: Array<{ name: string; args?: any }> = [];
  const base = options.base ?? {
    ok: true, generatedAt: "2026-09-17T12:00:00Z",
    business: { id: BUSINESS, name: "Fixture business" }, scope: null,
    recommendations: [], disclaimer: "아직 추천에 사용할 수 있는 완료 측정이 없습니다.",
  };
  const db = {
    from(table: string) {
      calls.push({ name: table });
      const filters: Array<[string, unknown]> = [];
      const orders: Array<[string, any]> = [];
      let limit = Infinity;
      const result = () => {
        if (options.fail === table) return { data: null, count: null, error: { message: "fixture error" } };
        if (table === "measurements") {
          assert.deepEqual(filters, [["org_id", ORG], ["run_id", RUN], ["valid", true]]);
          return { data: null, count: options.validCount ?? 24, error: null };
        }
        assert.equal(table, "measurement_runs");
        let rows = (options.runs ?? [latest]).filter(row => filters.every(([key, value]) => (row as any)[key] === value));
        rows = [...rows].sort((a, b) => {
          for (const [key, config] of orders) {
            const left = (a as any)[key], right = (b as any)[key];
            if (left === right) continue;
            if (left === null) return config.nullsFirst ? -1 : 1;
            if (right === null) return config.nullsFirst ? 1 : -1;
            return String(left).localeCompare(String(right)) * (config.ascending ? 1 : -1);
          }
          return 0;
        });
        return { data: rows.slice(0, limit)[0] ?? null, error: null };
      };
      const chain: any = {
        select: (_columns: string, config?: any) => {
          if (table === "measurements") assert.deepEqual(JSON.parse(JSON.stringify(config)), { count: "exact", head: true });
          return chain;
        },
        eq: (key: string, value: unknown) => { filters.push([key, value]); return chain; },
        is: (key: string, value: unknown) => { filters.push([key, value]); return chain; },
        order: (key: string, config: any) => { orders.push([key, config]); return chain; },
        limit: (value: number) => { limit = value; return chain; },
        maybeSingle: async () => result(),
        then: (resolve: any, reject: any) => Promise.resolve(result()).then(resolve, reject),
      };
      return chain;
    },
    async rpc(name: string, args: unknown) {
      calls.push({ name, args });
      if (options.fail === name) return { data: null, error: { message: "fixture error" } };
      const results: Record<string, unknown> = {
        get_compatible_audit_runs_v01: options.compatible ?? [],
        get_competitor_significance_v01: [
          { canonical_key: "a", tier: "core" }, { canonical_key: "b", tier: "notable" },
          { canonical_key: "c", tier: "observe" },
        ],
        get_first_run_profile_source_observations_v03: options.profiles ?? [profile],
        get_first_run_content_source_observations_v01: options.contents ?? [content],
        get_first_run_independent_site_observations_v04: options.independent ?? [],
        get_repeat_independent_site_observations_v02: options.repeatIndependent ?? [],
        get_global_high_visibility_source_patterns_v02: {},
      };
      assert.ok(name in results, `Unexpected RPC ${name}`);
      return { data: results[name], error: null };
    },
  };
  let handler: (request: Request) => Promise<Response>;
  runInNewContext(edgeCode, {
    Deno: {
      env: { get: (name: string) => ({ SUPABASE_URL: "https://fixture.invalid", SUPABASE_SERVICE_ROLE_KEY: "fixture-not-a-key" })[name] },
      serve: (fn: typeof handler) => { handler = fn; },
    },
    createClient: () => db, Request, Response, URL, console: { error: () => {} },
    fetch: async (url: string, init: any) => {
      assert.equal(url, "https://fixture.invalid/functions/v1/visibility-action-recommendations");
      assert.equal(init.headers.authorization, "Bearer fixture");
      assert.deepEqual(JSON.parse(init.body), { orgId: ORG, businessId: BUSINESS });
      return Response.json(base, { status: options.baseStatus ?? 200 });
    },
  });
  const response = await handler!(new Request("https://fixture.invalid", {
    method: "POST", headers: { authorization: "Bearer fixture" },
    body: JSON.stringify({ orgId: ORG, businessId: BUSINESS }),
  }));
  const payload = await response.json();
  const exports: any = {};
  runInNewContext(dtoCode, { exports, URL, Response, console });
  const parsed = payload.ok ? JSON.parse(JSON.stringify(exports.parseActionRecommendationsResponse(payload))) : null;
  const display = parsed?.ok ? runInNewContext(`${displayCode}\nbuildDisplayRecommendations(recommendations)`, {
    recommendations: parsed.data.recommendations,
  }) : null;
  return { payload, parsed, display, status: response.status, calls };
}

function legacyScope(repetitions: number) {
  return { runId: RUN, runName: latest.name, measuredAt: latest.completed_at, repetitions, validCount: 24 * repetitions, competitorCount: 2 };
}
function baseWithScope(repetitions: number, recommendations: unknown[] = []) {
  return { ok: true, generatedAt: "2026-09-17T12:00:00Z", business: { id: BUSINESS, name: "Fixture business" }, scope: legacyScope(repetitions), recommendations, disclaimer: "Existing disclaimer" };
}

describe("latest observation survives missing comparison payloads", () => {
  it("returns the two-competitor profile and content clues through the real server DTO parser", async () => {
    const { payload, parsed, display, calls } = await execute();
    assert.equal(parsed.ok, true);
    assert.equal(payload.scope.runId, RUN);
    assert.equal(payload.scope.validCount, 24);
    assert.equal(payload.scope.competitorCount, 2);
    assert.equal(payload.scope.repetitions, 1);
    assert.deepEqual(parsed.data.recommendations.map((r: any) => r.id), ["observation:profile:mycle", "observation:content:tistory"]);
    assert.equal(parsed.data.recommendations[0].evidence.competitorResponseCount, 4);
    assert.equal(parsed.data.recommendations[0].evidence.distinctCompetitorCount, 2);
    assert.equal(parsed.data.recommendations[0].sourceGroups[0].platforms[0].linkedCompetitors.length, 2);
    assert.equal(display.length, 2);
    assert.equal(display[0].id, "observation:profile:mycle");
    assert.match(payload.disclaimer, /이전 측정과 동일 조건인지 확인할 수 없어/);
    for (const call of calls.filter(c => c.args?.p_run_id)) assert.equal(call.args.p_run_id, RUN);
    assert.ok(!calls.some(c => c.name === "get_repeat_independent_site_observations_v02"));
  });

  it("scopes latest selection to this organization, business and completed standalone audits", async () => {
    const newer = { ...latest, completed_at: "2026-09-10T00:00:00Z" };
    const runs = [
      { ...newer, org_id: "other-org" }, { ...newer, business_id: "other-business" },
      { ...newer, status: "running" }, { ...newer, experiment_id: "experiment" as any },
      { ...newer, run_type: "experiment" }, { ...newer, phase: "baseline" },
      { ...latest, id: olderRun, completed_at: "2026-09-08T00:00:00Z" }, latest,
    ];
    const { payload, parsed } = await execute({ runs });
    assert.equal(payload.scope.runId, RUN);
    assert.equal(parsed.ok, true);
  });

  it("leaves a genuinely unmeasured business empty", async () => {
    const { payload, calls } = await execute({ runs: [] });
    assert.equal(payload.scope, null);
    assert.deepEqual(payload.recommendations, []);
    assert.equal(payload.disclaimer, "아직 추천에 사용할 수 있는 완료 측정이 없습니다.");
    assert.ok(!calls.some(c => c.args?.p_run_id));
  });

  it("does not invent clues when the RPCs return no eligible evidence", async () => {
    const { payload, parsed } = await execute({ profiles: [], contents: [], validCount: 0 });
    assert.equal(parsed.ok, true);
    assert.equal(payload.scope.validCount, 0);
    assert.deepEqual(payload.recommendations, []);
  });

  for (const fail of ["measurement_runs", "measurements", "get_competitor_significance_v01", "get_compatible_audit_runs_v01"]) {
    it(`returns an error instead of silently reporting no evidence when ${fail} fails`, async () => {
      const { payload, status } = await execute({ fail });
      assert.equal(status, 500);
      assert.equal(payload.ok, false);
    });
  }

  for (const baseStatus of [401, 403, 404]) {
    it(`does not execute fallback reads after legacy authorization fails (${baseStatus})`, async () => {
      const { calls, status } = await execute({ base: { ok: false, error: "FORBIDDEN" }, baseStatus });
      assert.equal(status, baseStatus);
      assert.equal(calls.length, 0);
    });
  }

  it("refreshes a legacy single-run scope from the latest completed observation", async () => {
    const { payload, calls } = await execute({
      base: baseWithScope(1),
      compatible: [{ run_id: RUN }],
    });
    assert.deepEqual(payload.scope, legacyScope(1));
    assert.ok(calls.some((c) => c.name === "measurement_runs"));
    assert.ok(
      payload.recommendations.some(
        (r: any) => r.id === "observation:profile:mycle",
      ),
    );
    assert.equal(payload.comparison.status, "single");
  });

  it("keeps latest-run clues distinct while comparison is verified", async () => {
    const { payload, parsed, display, calls } = await execute({
      base: baseWithScope(2),
      compatible: [{ run_id: RUN }, { run_id: olderRun }],
    });
    assert.equal(payload.comparison.status, "verified");
    assert.equal(payload.scope.runId, RUN);
    assert.equal(payload.scope.validCount, 24);
    assert.equal(parsed.ok, true);
    assert.ok(
      calls.some(
        (c) => c.name === "get_first_run_profile_source_observations_v03",
      ),
    );
    assert.ok(
      calls.some(
        (c) => c.name === "get_repeat_independent_site_observations_v02",
      ),
    );
    assert.ok(calls.some((c) => c.name === "measurement_runs"));
    assert.ok(
      display.every(
        (r: any) => r.evidenceLabel === "최근 측정 관찰",
      ),
    );
  });

  it("retains platform deduplication for an existing customer-facing source card", async () => {
    const first = await execute({ profiles: [profile, profile] });
    const rec = first.payload.recommendations[0];
    const { payload } = await execute({ base: baseWithScope(1, [{ ...rec, id: "source:mycle:trust" }]), compatible: [{ run_id: RUN }] });
    assert.equal(payload.recommendations.filter((r: any) => r.sourceGroups.some((g: any) => g.platforms.some((p: any) => p.key === "mycle"))).length, 1);
  });

  it("does not loosen independent-site ownership to accept two different competitors", async () => {
    const { payload } = await execute({ profiles: [], contents: [], independent: [{ ...profile, source_key: "independent:fixture.invalid", source_name: "fixture.invalid" }] });
    assert.deepEqual(payload.recommendations, []);
  });
});
