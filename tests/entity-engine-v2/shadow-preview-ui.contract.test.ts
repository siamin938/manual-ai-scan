import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROUTE = resolve(
  process.cwd(),
  "src/routes/_authenticated/runs.$runId.shadow.tsx",
);
const source = readFileSync(ROUTE, "utf8");

function compact(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

describe("Entity v2 shadow diagnostics UI contract", () => {
  it("is a hidden run-scoped authenticated route", () => {
    expect(source).toContain(
      'createFileRoute("/_authenticated/runs/$runId/shadow")',
    );
    expect(source).toContain('name: "robots", content: "noindex,nofollow"');
  });

  it("invokes only the read-only shadow preview function", () => {
    expect(source).toContain(
      'supabase.functions.invoke("entity-v2-shadow-preview"',
    );
    expect(source).toContain("body: { run_id: runId }");
  });

  it("does not contain database mutation calls", () => {
    const normalized = compact(source);
    expect(normalized).not.toContain(".insert(");
    expect(normalized).not.toContain(".update(");
    expect(normalized).not.toContain(".upsert(");
    expect(normalized).not.toContain(".delete(");
  });

  it("does not render raw AI response text", () => {
    expect(source).not.toContain("response_text");
    expect(source).toContain("차이 있는 답변만 보기");
  });

  it("clearly labels the preview as non-authoritative", () => {
    expect(source).toContain("내부 진단");
    expect(source).toContain("새로운 AI 측정을 실행하지 않습니다");
    expect(source).toContain("DB 데이터를 변경하지 않습니다");
    expect(source).toContain("v2 결과는 고객 노출·점수·저장 데이터에 반영되지 않습니다");
  });
});
