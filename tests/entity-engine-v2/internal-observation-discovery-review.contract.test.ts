import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationSource = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20261009043500_internal_observation_discovery_review_queue_v092.sql",
  ),
  "utf8",
);

const serverSource = readFileSync(
  resolve(
    process.cwd(),
    "src/lib/internal-observation-discovery-review.functions.ts",
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

describe("internal observation discovery review queue v0.9.2", () => {
  it("persists discovery review separately from the measurement pipeline", () => {
    expect(migrationSource).toContain(
      "create table if not exists public.internal_observation_discovery_candidates",
    );
    expect(migrationSource).toContain(
      "references public.internal_observation_pipeline_items(id)",
    );
    expect(migrationSource).toContain(
      "Reserved for v0.9.3 guarded promotion. v0.9.2 must leave this null.",
    );
    expect(migrationSource).toContain(
      "unique (org_id, idempotency_key)",
    );
    expect(migrationSource).toContain(
      "'needs_identity_review'",
    );
  });

  it("keeps the review queue service-role only", () => {
    expect(migrationSource).toContain(
      "alter table public.internal_observation_discovery_candidates enable row level security",
    );
    expect(migrationSource).toContain(
      "revoke all on table public.internal_observation_discovery_candidates from authenticated",
    );
    expect(migrationSource).toContain(
      "grant select, insert, update, delete on table public.internal_observation_discovery_candidates to service_role",
    );
    expect(serverSource).toContain("can_view_data_asset_admin_v01");
    expect(serverSource).toContain("canOperateOrg");
  });

  it("is idempotent for the same reviewed business surface", () => {
    expect(serverSource).toContain('"v0.9.2"');
    expect(serverSource).toContain("reviewIdempotencyKey");
    expect(serverSource).toContain('.eq("idempotency_key", idempotencyKey)');
    expect(serverSource).toContain("internal_discovery_candidate_seen_again");
    expect(serverSource).toContain("last_seen_at: now");
  });

  it("stores evidence and review decisions but cannot create measurement side effects", () => {
    expect(serverSource).toContain("source_evidence");
    expect(serverSource).toContain("discovery_query");
    expect(serverSource).toContain("duplicate_status");
    expect(serverSource).toContain("review_status");
    expect(serverSource).toContain("internal_discovery_review_status_changed");

    for (const source of [serverSource, routeSource]) {
      expect(source).not.toContain(
        'saveDiscoveryCandidate({\n        data: {\n          orgId,\n          runId',
      );
    }

    expect(serverSource).not.toContain('.from("measurement_runs").insert');
    expect(serverSource).not.toContain('.from("measurement_jobs").insert');
    expect(serverSource).not.toContain(
      '.from("measurement_credit_accounts").update',
    );
    expect(serverSource).not.toContain(
      '.from("internal_observation_pipeline_items").insert',
    );
    expect(serverSource).not.toContain('functions.invoke("enqueue-run"');
    expect(serverSource).not.toContain("createCustomerMeasurementRun");
  });

  it("blocks review mutation after future promotion", () => {
    expect(serverSource).toContain('existingRaw["promoted_pipeline_item_id"]');
    expect(serverSource).toContain('"ALREADY_PROMOTED"');
    expect(serverSource).toContain("promoted_pipeline_item_id: null");
  });

  it("exposes explicit operator review states in the UI without auto-promotion", () => {
    expect(routeSource).toContain("v0.9.2 Review Queue");
    expect(routeSource).toContain("검토 후보로 저장");
    expect(routeSource).toContain("Discovery Review Queue");
    expect(routeSource).toContain("검토 대기");
    expect(routeSource).toContain("승인");
    expect(routeSource).toContain("제외");
    expect(routeSource).toContain("중복");
    expect(routeSource).toContain("지점 확인 필요");
    expect(routeSource).toContain(
      "승인만으로 업체 등록·24문항 준비·Run 생성·측정권 차감은 발생하지 않습니다.",
    );
    expect(routeSource).toContain(
      "v0.9.3 승격은 별도 미리보기와 명시적 확인을",
    );
    expect(routeSource).toContain(
      "기존 수집 파이프라인의 준비 대기(pending) 후보까지만 생성합니다.",
    );
  });
});
