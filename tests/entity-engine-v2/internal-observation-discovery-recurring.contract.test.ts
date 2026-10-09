import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const storageSource = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20261009054000_internal_observation_discovery_recurring_v094.sql",
  ),
  "utf8",
);

const gateSource = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20261009055200_internal_observation_discovery_cron_gate_v094.sql",
  ),
  "utf8",
);

const workerSource = readFileSync(
  resolve(
    process.cwd(),
    "supabase/functions/internal-observation-discovery-batch/index.ts",
  ),
  "utf8",
);

const serverSource = readFileSync(
  resolve(
    process.cwd(),
    "src/lib/internal-observation-discovery-recurring.functions.ts",
  ),
  "utf8",
);

const routeSource = readFileSync(
  resolve(
    process.cwd(),
    "src/routes/_authenticated/internal-observation-pipeline.tsx",
  ),
  "utf8",
);

const configSource = readFileSync(
  resolve(process.cwd(), "supabase/config.toml"),
  "utf8",
);

describe("internal observation recurring discovery v0.9.4", () => {
  it("creates schedule and batch storage with a disabled global cron scaffold", () => {
    expect(storageSource).toContain(
      "create table if not exists public.internal_observation_discovery_schedules",
    );
    expect(storageSource).toContain(
      "create table if not exists public.internal_observation_discovery_batches",
    );
    expect(storageSource).toContain(
      "create table if not exists public.internal_observation_discovery_batch_items",
    );
    expect(storageSource).toContain(
      "'internal-observation-discovery-scheduler-v094'",
    );
    expect(storageSource).toContain("'0 * * * *'");
    expect(storageSource).toContain("active := false");
    expect(gateSource).toContain(
      "set_internal_observation_discovery_cron_active_v094",
    );
  });

  it("supports manual user auth and future internal cron auth in one worker", () => {
    expect(configSource).toContain(
      "[functions.internal-observation-discovery-batch]",
    );
    expect(configSource).toContain("verify_jwt = false");
    expect(workerSource).toContain('request.headers.get("x-internal-secret")');
    expect(workerSource).toContain('Deno.env.get("INTERNAL_CRON_SECRET")');
    expect(workerSource).toContain('request.headers.get("authorization")');
    expect(workerSource).toContain("db.auth.getUser(token)");
    expect(workerSource).toContain('body.runDue === true');
    expect(workerSource).toContain("scheduleDue(row, now)");
  });

  it("classifies recurring results as new, changed, or unchanged", () => {
    expect(storageSource).toContain(
      "classification in ('new','changed','unchanged')",
    );
    expect(workerSource).toContain('"new" | "changed" | "unchanged"');
    expect(workerSource).toContain("materiallyChanged({");
    expect(workerSource).toContain(
      '? "changed"\n          : "unchanged"',
    );
    expect(workerSource).toContain("newCount += 1");
    expect(workerSource).toContain("changedCount += 1");
    expect(workerSource).toContain("unchangedCount += 1");
    expect(workerSource).toContain(
      'discovery_source: triggerSource === "scheduled" ? "scheduled_web" : "web_preview"',
    );
  });

  it("dedupes recurring results by exact public URL identity and ignores note wording drift", () => {
    expect(workerSource).toContain("findIdentityMatchByExactUrl");
    expect(workerSource).toContain("identityUrlsFromPayload");
    expect(workerSource).toContain("identityUrlsFromStored");
    expect(workerSource).toContain("materiallyChanged");
    expect(workerSource).toContain("payload.evidence.some");
    expect(workerSource).not.toContain(
      "existingFingerprint === candidateFingerprint ? \"unchanged\" : \"changed\"",
    );
    expect(workerSource).not.toContain(
      "JSON.stringify(canonicalStoredPayload(existing))",
    );
  });

  it("surfaces changed unpromoted decisions for review without touching promoted rows", () => {
    expect(workerSource).toContain("resetForReview");
    expect(workerSource).toContain('updatePayload.review_status = "needs_review"');
    expect(workerSource).toContain("updatePayload.reviewed_by = null");
    expect(workerSource).toContain("updatePayload.reviewed_at = null");
    expect(workerSource).toContain("!promoted");
  });

  it("cannot auto-approve, auto-promote, prepare, measure, or debit credits", () => {
    expect(workerSource).toContain("auto_approved: false");
    expect(workerSource).toContain("auto_promoted: false");
    expect(workerSource).toContain("measurement_side_effects: false");
    expect(workerSource).toContain("measurement_credit_debited: false");

    expect(workerSource).not.toContain('review_status: "approved"');
    expect(workerSource).not.toContain("promoted_pipeline_item_id: reviewCandidateId");
    expect(workerSource).not.toContain(
      '.update({ promoted_pipeline_item_id:',
    );
    expect(workerSource).not.toContain("prepareInternalObservationCandidate");
    expect(workerSource).not.toContain('.from("measurement_runs").insert');
    expect(workerSource).not.toContain('.from("measurement_jobs").insert');
    expect(workerSource).not.toContain(
      '.from("measurement_credit_accounts").update',
    );
    expect(workerSource).not.toContain('functions.invoke("enqueue-run"');
  });

  it("reuses the latest persisted discovery query after a page refresh", () => {
    expect(routeSource).toContain("latestDiscoveryReviewQuery");
    expect(routeSource).toContain("recurringDiscoveryQuery");
    expect(routeSource).toContain("최근 Review Queue 조건");
    expect(routeSource).toContain(
      "Review Queue의 가장 최근 Discovery 조건을 자동으로 재사용합니다.",
    );
  });

  it("keeps profile eligibility separate from the global cron gate", () => {
    expect(serverSource).toContain("enabled: false");
    expect(serverSource).toContain(
      "setInternalObservationDiscoveryScheduleEnabled",
    );
    expect(serverSource).toContain("global_cron_changed: false");
    expect(serverSource).not.toContain(
      'admin.rpc("set_internal_observation_discovery_cron_active_v094"',
    );
    expect(routeSource).toContain("글로벌 자동 반복");
    expect(routeSource).toContain("글로벌 Gate OFF");
    expect(routeSource).toContain("지금 1회 실행");
    expect(routeSource).toContain("반복 탐색 프로필 저장 · 자동 OFF");
    expect(routeSource).toContain(
      "수동 ‘지금 1회 실행’만",
    );
  });
});
