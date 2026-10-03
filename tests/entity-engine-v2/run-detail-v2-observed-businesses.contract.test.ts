import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const src = readFileSync(resolve(process.cwd(), "src/routes/_authenticated/runs.$runId.tsx"), "utf8");

function v2Block(): string {
  const start = src.indexOf("v2 확정 업체 기준, 정확히 같은 측정일 때만");
  const end = src.indexOf("AI 답변에서 1차 감지된 업체 후보", start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return src.slice(start, end);
}

describe("run detail observed-business summary contract", () => {
  it("uses the existing v2 read gateway through useServerFn", () => {
    expect(src).toContain('import { getEntityFactsV2ReadGateway } from "@/lib/entity-facts-v2-read-gateway.functions"');
    expect(src).toContain("useServerFn(getEntityFactsV2ReadGateway)");
    expect(src).toContain("enabled: !!activeOrgId && !!runBusinessId");
  });

  it("guards v2 rows with the exact scope.runId === runId check", () => {
    const guard = src.indexOf("v2Response.data.scope.runId === runId");
    const rows = src.indexOf("const v2ShareRows = v2ExactRun");
    expect(src).toContain("v2Response.ok === true");
    expect(guard).toBeGreaterThan(-1);
    expect(rows).toBeGreaterThan(guard);
  });

  it("builds target and competitor rows from v2 truth", () => {
    expect(src).toContain("count: v2ExactRun.overview.confirmedMentionCount");
    expect(src).toContain("v2ExactRun.competitors.map");
    expect(src).toContain("count: c.responseCount");
    expect(src).toContain("v2ExactRun.overview.validCount");
  });

  it("v2 display uses neutral badges and never 자동 발견", () => {
    const block = v2Block();
    expect(block).toContain("함께 관찰");
    expect(block).toContain("내 업체");
    expect(block).toContain("AI 진단 상세와 같은 확정 업체 기준");
    expect(block).not.toContain("자동 발견");
  });

  it("legacy fallback is titled as a first-pass candidate list", () => {
    expect(src).toContain("showSummary && !v2ShareRows");
    expect(src).toContain("AI 답변에서 1차 감지된 업체 후보");
    expect(src).toContain("1차 감지 업체 후보 (");
  });

  it("does not touch engine/parser/materialization code", () => {
    let changed = "";
    try {
      changed = execSync("git diff --name-only HEAD", { encoding: "utf8" });
    } catch {
      return;
    }
    expect(changed).not.toMatch(/supabase\/(functions|migrations)\//);
    expect(changed).not.toMatch(/entity-facts-v2-(materialize|read-gateway\.server|read-gateway\.build)/);
  });
});
