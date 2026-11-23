import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

const source = readFileSync("supabase/functions/process-measurement-job/index.ts", "utf8");
const processJob = runInNewContext(
  stripTypeScriptTypes(source.slice(source.indexOf("async function processJob("), source.indexOf("Deno.serve("))) + "\nprocessJob",
  { numberValue: Number },
);

function recoveryFixture({ payload = true, readError = false, costError = false, completionError = false } = {}) {
  const completed = [];
  const costs = [];
  const calls = [];
  const results = {
    measurement_runs: { data: { status: "running", run_type: "audit" } },
    measurements: { data: { id: "measurement", actual_cost_usd: 1, provider_model: "saved-model" } },
    provider_payloads: { data: payload ? { job_id: "job" } : null, error: readError },
    cost_events: { error: costError },
    measurement_jobs: { error: completionError },
  };
  const client = {
    from(table) {
      assert.ok(Object.hasOwn(results, table), "unexpected table: " + table);
      calls.push(table);
      return {
        select() { return this; },
        eq() { return this; },
        single() { return results[table]; },
        maybeSingle() { return results[table]; },
        update(row) { completed.push(row); return this; },
        upsert(row, options) { costs.push({ row, options }); return results[table]; },
        then(resolve) { resolve(results[table]); },
      };
    },
    rpc: async () => ({ error: null }),
  };
  const run = () => processJob(client, { id: "job", org_id: "org", run_id: "run" }, 7);
  return { run, completed, costs, calls };
}

test("a partial answer never becomes a completed job or triggers a new provider call", async () => {
  const f = recoveryFixture({ payload: false });
  await assert.rejects(f.run(), /INCOMPLETE_MEASUREMENT_EVIDENCE/);
  assert.equal(f.completed.length, 0);
  assert.equal(f.costs.length, 1);
});

test("recovery preserves an existing cost event and completes once saved evidence is confirmed", async () => {
  const f = recoveryFixture();
  await f.run();
  assert.deepEqual({ ...f.costs[0].options }, { onConflict: "job_id", ignoreDuplicates: true });
  assert.equal(f.completed[0].status, "completed");
});

for (const [condition, code] of [["readError", "RECOVERY_EVIDENCE_CHECK_FAILED"], ["costError", "COST_SAVE_FAILED"], ["completionError", "JOB_COMPLETE_FAILED"]]) {
  test("recovery surfaces " + code, async () => {
    const f = recoveryFixture({ [condition]: true });
    await assert.rejects(f.run(), new RegExp(code));
    if (condition !== "completionError") assert.equal(f.completed.length, 0);
  });
}
