import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import {stripTypeScriptTypes} from 'node:module';
const ts={ScriptTarget:{ES2022:0},ModuleKind:{CommonJS:0},transpileModule(s){const names=[...s.matchAll(/^export (?:async )?function (\w+)/gm)].map(m=>m[1]);let outputText=stripTypeScriptTypes(s).replace(/^export /gm,'');outputText+='\n'+names.map(n=>'exports.'+n+'='+n+';').join('\n');return{outputText}}};
import { describe, it } from "node:test";

const edgePath = resolve("supabase/functions/visibility-action-recommendations-v2/index.ts");
const source = readFileSync(edgePath, "utf8").replace(/^import .*createClient.*;\n/, "");
const edgeCode = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const comparisonSource = readFileSync(resolve("src/lib/visibility-comparison.server.ts"), "utf8").replace(/^import .*$/gm, "").replace(/^export /gm, "");
const dtoSource = comparisonSource + "\n" + readFileSync(resolve("src/lib/visibility-actions.server.ts"), "utf8").replace(/^import \{ parseVisibilityComparison \}.*\n/m, "");
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

                
                         
                                 
                      
                         
                      
                       
                       
                          
                                
                
  

async function execute(options          = {}) {
  const calls                                      = [];
  const base = options.base ?? {
    ok: true, generatedAt: "2026-09-17T12:00:00Z",
    business: { id: BUSINESS, name: "Fixture business" }, scope: null,
    recommendations: [], disclaimer: "아직 추천에 사용할 수 있는 완료 측정이 없습니다.",
  };
  const db = {
    from(table        ) {
      calls.push({ name: table });
      const filters                           = [];
      const orders                       = [];
      let limit = Infinity;
      const result = () => {
        if (options.fail === table) return { data: null, count: null, error: { message: "fixture error" } };
        if (table === "measurements") {
          assert.deepEqual(filters, [["org_id", ORG], ["run_id", RUN], ["valid", true]]);
          return { data: null, count: options.validCount ?? 24, error: null };
        }
        assert.equal(table, "measurement_runs");
        let rows = (options.runs ?? [latest]).filter(row => filters.every(([key, value]) => (row       )[key] === value));
        rows = [...rows].sort((a, b) => {
          for (const [key, config] of orders) {
            const left = (a       )[key], right = (b       )[key];
            if (left === right) continue;
            if (left === null) return config.nullsFirst ? -1 : 1;
            if (right === null) return config.nullsFirst ? 1 : -1;
            return String(left).localeCompare(String(right)) * (config.ascending ? 1 : -1);
          }
          return 0;
        });
        return { data: rows.slice(0, limit)[0] ?? null, error: null };
      };
      const chain      = {
        select: (_columns        , config      ) => {
          if (table === "measurements") assert.deepEqual(JSON.parse(JSON.stringify(config)), { count: "exact", head: true });
          return chain;
        },
        eq: (key        , value         ) => { filters.push([key, value]); return chain; },
        is: (key        , value         ) => { filters.push([key, value]); return chain; },
        order: (key        , config     ) => { orders.push([key, config]); return chain; },
        limit: (value        ) => { limit = value; return chain; },
        maybeSingle: async () => result(),
        then: (resolve     , reject     ) => Promise.resolve(result()).then(resolve, reject),
      };
      return chain;
    },
    async rpc(name        , args         ) {
      calls.push({ name, args });
      if (options.fail === name) return { data: null, error: { message: "fixture error" } };
      const results                          = {
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
  let handler                                         ;
  runInNewContext(edgeCode, {
    Deno: {
      env: { get: (name        ) => ({ SUPABASE_URL: "https://fixture.invalid", SUPABASE_SERVICE_ROLE_KEY: "fixture-not-a-key" })[name] },
      serve: (fn                ) => { handler = fn; },
    },
    createClient: () => db, Request, Response, URL, console: { error: () => {} },
    fetch: async (url        , init     ) => {
      assert.equal(url, "https://fixture.invalid/functions/v1/visibility-action-recommendations");
      assert.equal(init.headers.authorization, "Bearer fixture");
      assert.deepEqual(JSON.parse(init.body), { orgId: ORG, businessId: BUSINESS });
      return Response.json(base, { status: options.baseStatus ?? 200 });
    },
  });
  const response = await handler (new Request("https://fixture.invalid", {
    method: "POST", headers: { authorization: "Bearer fixture" },
    body: JSON.stringify({ orgId: ORG, businessId: BUSINESS }),
  }));
  const payload = await response.json();
  const exports      = {};
  runInNewContext(dtoCode, { exports, URL, Response, console });
  const parsed = payload.ok ? JSON.parse(JSON.stringify(exports.parseActionRecommendationsResponse(payload))) : null;
  const display = parsed?.ok ? runInNewContext(`${displayCode}\nbuildDisplayRecommendations(recommendations)`, {
    recommendations: parsed.data.recommendations,
  }) : null;
  return { payload, parsed, display, status: response.status, calls };
}

function legacyScope(repetitions        ) {
  return { runId: RUN, runName: latest.name, measuredAt: latest.completed_at, repetitions, validCount: 24 * repetitions, competitorCount: 2 };
}
function baseWithScope(repetitions        , recommendations            = []) {
  return { ok: true, generatedAt: "2026-09-17T12:00:00Z", business: { id: BUSINESS, name: "Fixture business" }, scope: legacyScope(repetitions), recommendations, disclaimer: "Existing disclaimer" };
}


describe("persistent measurement evidence actions", () => {
 it("retains latest clues without historical comparison records", async()=>{
  const r=await execute(); assert.equal(r.status,200);assert.equal(r.parsed.ok,true);
  assert.equal(r.payload.comparison.status,"unverified");assert.equal(r.payload.scope.validCount,24);
  assert.equal(r.display.length,2);assert.equal(r.payload.availability,"complete");
 });
 it("keeps latest profile and content when two runs are compatible",async()=>{
  const r=await execute({base:baseWithScope(2),compatible:[{run_id:RUN},{run_id:olderRun}]});
  assert.equal(r.status,200);assert.equal(r.payload.comparison.status,"verified");
  assert.ok(r.calls.some(x=>x.name==="get_first_run_profile_source_observations_v03"));
  assert.equal(r.display.length,2);assert.equal(r.payload.scope.validCount,24);
  for(const card of r.display){assert.equal(card.evidence.measurementCount,24);assert.equal(card.evidenceLabel,"최근 측정 관찰");}
 });
 for(const [rpc,label] of [["get_first_run_profile_source_observations_v03","업체 프로필"],["get_first_run_content_source_observations_v01","콘텐츠 출처"],["get_first_run_independent_site_observations_v04","홈페이지 출처"]]){
  it(`reports partial evidence when ${rpc} fails`,async()=>{
   const r=await execute({fail:rpc});assert.equal(r.status,200);assert.equal(r.parsed.ok,true);
   assert.equal(r.parsed.data.availability,"partial");assert.ok(r.parsed.data.unavailableSections.includes(label));
  });
 }
 it("does not turn lookup failures into zero compatible runs",async()=>{
  const r=await execute({fail:"get_compatible_audit_runs_v01"});assert.equal(r.status,500);assert.equal(r.payload.ok,false);
 });
 it("does not bypass legacy authorization failures",async()=>{
  const r=await execute({base:{ok:false,error:"FORBIDDEN"},baseStatus:403});assert.equal(r.status,403);assert.equal(r.calls.length,0);
 });
 it("never uses another organization or an experiment as latest scope",async()=>{
  const r=await execute({runs:[{...latest,org_id:olderRun,completed_at:"2027-01-01"},{...latest,experiment_id:olderRun,completed_at:"2027-01-01"},latest]});
  assert.equal(r.payload.scope.runId,RUN);assert.equal(r.payload.scope.measuredAt,latest.completed_at);
 });
 it("genuine empty evidence remains complete, distinct from a failed lookup",async()=>{
  const r=await execute({profiles:[],contents:[]});assert.equal(r.payload.availability,"complete");assert.equal(r.display.length,0);
 });
});
