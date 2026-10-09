import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const edgeSource = readFileSync(
  resolve(
    process.cwd(),
    "supabase/functions/internal-observation-discovery-preview/index.ts",
  ),
  "utf8",
);

const serverSource = readFileSync(
  resolve(
    process.cwd(),
    "src/lib/internal-observation-discovery.functions.ts",
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

describe("internal observation discovery preview v0.9.1", () => {
  it("is explicitly read-only and cannot create measurement side effects", () => {
    for (const source of [edgeSource, serverSource]) {
      expect(source).not.toContain('.from("measurement_runs").insert');
      expect(source).not.toContain('.from("measurement_jobs").insert');
      expect(source).not.toContain('.from("measurement_credit_accounts").update');
      expect(source).not.toContain('functions.invoke("enqueue-run"');
      expect(source).not.toContain("createCustomerMeasurementRun");
    }

    expect(edgeSource).not.toContain(".insert(");
    expect(edgeSource).not.toContain(".update(");
    expect(edgeSource).not.toContain(".upsert(");
    expect(edgeSource).toContain("measurementSideEffects: false");
    expect(edgeSource).toContain("measurementCreditDebited: false");
    expect(edgeSource).toContain("persisted: false");
  });

  it("requires authenticated internal-organization operator access", () => {
    expect(configSource).toContain(
      "[functions.internal-observation-discovery-preview]",
    );
    expect(configSource).toContain("verify_jwt = true");
    expect(edgeSource).toContain('request.headers.get("authorization")');
    expect(edgeSource).toContain('measurement_data_origin", "internal_observation"');
    expect(edgeSource).toContain("WRITE_ROLES");
    expect(serverSource).toContain("can_view_data_asset_admin_v01");
  });

  it("parses fenced JSON without invalid escaped-backtick regex literals", () => {
    expect(edgeSource).toContain('unfenced.startsWith("```")');
    expect(edgeSource).not.toContain("/^\\`\\`\\`");
  });

  it("uses public web search and keeps only provider-observed evidence URLs", () => {
    expect(edgeSource).toContain('type: "web_search"');
    expect(edgeSource).toContain("search_context_size: \"medium\"");
    expect(edgeSource).toContain("store: false");
    expect(edgeSource).toContain('include: ["web_search_call.action.sources"]');
    expect(edgeSource).toContain("collectSourceUrls(payload)");
    expect(edgeSource).toContain("sourceByUrl.get(requestedUrl)");
    expect(edgeSource).toContain("if (evidence.length === 0) continue");
  });

  it("surfaces duplicate warnings without auto-merging or auto-registering", () => {
    expect(edgeSource).toContain('"existing_business_exact"');
    expect(edgeSource).toContain('"existing_pipeline_exact"');
    expect(edgeSource).toContain('"existing_domain_overlap"');
    expect(edgeSource).not.toContain("auto-merge");
    expect(routeSource).toContain("Preview 결과는 자동 등록하지 않습니다.");
    expect(routeSource).toContain("Preview 결과는 자동 등록하지 않습니다.");
    expect(routeSource).toContain("v0.9.3 전까지 기존 측정 파이프라인으로 자동 이동하지 않습니다.");
  });

  it("exposes the read-only preview through the internal operations UI", () => {
    expect(serverSource).toContain(
      'functions.invoke(\n        "internal-observation-discovery-preview"',
    );
    expect(routeSource).toContain("Discovery v0.9.1 Preview");
    expect(routeSource).toContain("공개 업체 Discovery Preview");
    expect(routeSource).toContain("Preview 자체 저장 없음");
    expect(routeSource).toContain("측정권 차감 없음");
    expect(routeSource).toContain("OpenAI 웹 검색 호출만 발생합니다.");
  });
});
