import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const pipelineSource = readFileSync(
  resolve(process.cwd(), "src/lib/internal-observation-pipeline.functions.ts"),
  "utf8",
);

const promotionSource = readFileSync(
  resolve(
    process.cwd(),
    "src/lib/internal-observation-discovery-promotion.functions.ts",
  ),
  "utf8",
);

const migrationSource = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20261009050500_internal_observation_discovery_guarded_promotion_v093.sql",
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

describe("internal observation discovery guarded promotion v0.9.3", () => {
  it("reuses the exact existing candidate intake core instead of creating a second intake path", () => {
    expect(pipelineSource).toContain(
      "export async function enqueueInternalObservationCandidateCore",
    );
    expect(pipelineSource).toContain(
      "return enqueueInternalObservationCandidateCore(data, context.userId)",
    );
    expect(pipelineSource).toContain(
      "export function buildInternalObservationCandidateIdempotencyKey",
    );
    expect(promotionSource).toContain(
      "enqueueInternalObservationCandidateCore(",
    );
    expect(promotionSource).toContain(
      "buildInternalObservationCandidateIdempotencyKey(",
    );
  });

  it("uses a fresh plan hash and exact explicit confirmation before mutation", () => {
    expect(promotionSource).toContain(
      'INTERNAL_OBSERVATION_DISCOVERY_PROMOTION_CONFIRMATION',
    );
    expect(promotionSource).toContain('"기존 파이프라인으로 승격"');
    expect(promotionSource).toContain("const planHash = await sha256");
    expect(promotionSource).toContain("if (plan.planHash !== data.planHash)");
    expect(promotionSource).toContain('"PLAN_CHANGED"');
    expect(promotionSource).toContain('"PLAN_BLOCKED"');
    expect(promotionSource).toContain('"INVALID_CONFIRMATION"');
  });

  it("keeps promotion bounded to pending candidate creation or idempotent linking", () => {
    expect(promotionSource).toContain('"create_pending_candidate"');
    expect(promotionSource).toContain('"link_existing_candidate"');
    expect(promotionSource).toContain('targetPipelineStatus: "pending"');
    expect(promotionSource).toContain("measurementSideEffects: false");
    expect(promotionSource).toContain("measurementCreditDebited: false");
    expect(promotionSource).toContain("runCreated: false");
    expect(promotionSource).toContain("jobsCreated: false");

    expect(promotionSource).not.toContain('.from("measurement_runs").insert');
    expect(promotionSource).not.toContain('.from("measurement_jobs").insert');
    expect(promotionSource).not.toContain(
      '.from("measurement_credit_accounts").update',
    );
    expect(promotionSource).not.toContain("prepareInternalObservationCandidate");
    expect(promotionSource).not.toContain('functions.invoke("enqueue-run"');
  });

  it("rechecks review and business identity state before promotion", () => {
    expect(promotionSource).toContain('"REVIEW_NOT_APPROVED"');
    expect(promotionSource).toContain('"ALREADY_PROMOTED"');
    expect(promotionSource).toContain('"PUBLIC_EVIDENCE_MISSING"');
    expect(promotionSource).toContain('"BUSINESS_IDENTITY_AMBIGUOUS"');
    expect(promotionSource).toContain('"EXISTING_BUSINESS_INACTIVE"');
    expect(promotionSource).toContain('reviewStatus !== "approved"');
    expect(promotionSource).toContain("matchingBusinesses.length > 1");
  });

  it("records an immutable review-to-pipeline audit link", () => {
    expect(migrationSource).toContain("promoted_at timestamptz");
    expect(migrationSource).toContain("promoted_by uuid");
    expect(migrationSource).toContain(
      "internal_observation_discovery_candidates_promoted_pipeline_unique",
    );
    expect(migrationSource).toContain("review_status='approved'");

    expect(promotionSource).toContain("promoted_pipeline_item_id: intake.itemId");
    expect(promotionSource).toContain("promoted_at: now");
    expect(promotionSource).toContain("promoted_by: context.userId");
    expect(promotionSource).toContain(
      '"internal_discovery_candidate_promoted"',
    );
  });

  it("exposes preview-first operator UX and does not auto-promote approved rows", () => {
    expect(routeSource).toContain("v0.9.3 Guarded Promotion");
    expect(routeSource).toContain("승격 미리보기");
    expect(routeSource).toContain("Discovery 후보 승격 미리보기");
    expect(routeSource).toContain("기존 파이프라인으로 승격");
    expect(routeSource).toContain("Run 생성: 없음 · Job 생성: 없음");
    expect(routeSource).toContain("통합 24문항 생성: 없음");
    expect(routeSource).toContain(
      "승격 뒤 기존 ‘준비 미리보기 → 준비 실행’ 단계를 별도로 거쳐야",
    );

    expect(routeSource).not.toContain(
      'reviewStatus === "approved" && confirmDiscoveryPromotion',
    );
  });
});
