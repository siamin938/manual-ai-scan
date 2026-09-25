import { describe, expect, it } from "vitest";
import {
  choosePreferredRunQuestionSetId,
  formatAutoRunName,
  getRunQuestionSetKind,
  isCustomRunQuestionSet,
} from "../../src/routes/_authenticated/runs.index";

describe("run question set selection", () => {
  it("recognizes only the v0.1 custom prefix", () => {
    expect(isCustomRunQuestionSet("맞춤 질문 · 카스페이스 구로점 · 2026-09-25")).toBe(true);
    expect(isCustomRunQuestionSet("Market 맞춤 질문")).toBe(false);
  });

  it("prefers the newest custom set in the existing newest-first order", () => {
    expect(
      choosePreferredRunQuestionSetId([
        { id: "new-baseline", name: "기본 질문" },
        { id: "new-custom", name: "맞춤 질문 · 새 세트" },
        { id: "old-custom", name: "맞춤 질문 · 이전 세트" },
      ]),
    ).toBe("new-custom");
  });

  it("falls back to the newest general set when no custom set exists", () => {
    expect(
      choosePreferredRunQuestionSetId([
        { id: "newest", name: "Market 질문" },
        { id: "older", name: "기본 질문" },
      ]),
    ).toBe("newest");
  });

  it("uses question count only to distinguish a selected baseline from other sets", () => {
    expect(getRunQuestionSetKind("맞춤 질문 · 업체", 8)).toBe("custom");
    expect(getRunQuestionSetKind("기본 질문", 24)).toBe("baseline");
    expect(getRunQuestionSetKind("Market 질문", 8)).toBe("other");
  });

  it("formats the auto run name by diagnostic kind", () => {
    expect(formatAutoRunName("카스페이스 구로점", "custom", "2026-09-25")).toBe(
      "카스페이스 구로점 맞춤 진단 2026-09-25",
    );
    expect(formatAutoRunName("카스페이스 구로점", "baseline", "2026-09-25")).toBe(
      "카스페이스 구로점 기본 진단 2026-09-25",
    );
    expect(formatAutoRunName("카스페이스 구로점", "other", "2026-09-25")).toBe(
      "카스페이스 구로점 측정 2026-09-25",
    );
  });

  it("protects user-edited names via the nameTouched contract in the dialog source", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(
      new URL("../../src/routes/_authenticated/runs.index.tsx", import.meta.url),
      "utf8",
    );
    // 자동 이름 effect는 nameTouched가 false일 때만 setName을 호출한다.
    expect(source).toContain("if (nameTouched || !selectedBusinessName) return;");
    // Input onChange에서 수동 수정을 기록한다.
    expect(source).toContain("setNameTouched(true);");
    // Dialog를 새로 열 때와 업체 변경 시 초기화한다.
    expect(source).toContain("if (open) setNameTouched(false);");
    expect(source).toMatch(/useEffect\(\(\) => \{\s*setNameTouched\(false\);\s*\}, \[businessId\]\)/);
  });

  it("keeps list and detail diagnostic labels in the source contract", async () => {
    const { readFileSync } = await import("node:fs");
    const listSource = readFileSync(
      new URL("../../src/routes/_authenticated/runs.index.tsx", import.meta.url),
      "utf8",
    );
    const detailSource = readFileSync(
      new URL("../../src/routes/_authenticated/runs.$runId.tsx", import.meta.url),
      "utf8",
    );

    for (const label of ["맞춤 진단", "기본 진단", "비교 기준", "질문 세트"]) {
      expect(listSource).toContain(label);
      expect(detailSource).toContain(label);
    }
    expect(detailSource).toContain(
      "최신 완료 맞춤 측정이 대시보드 대표 진단으로 사용됩니다.",
    );
    expect(detailSource).toContain("getRunQuestionSetKind(data.questionSetName ?? \"\", totalJobs)");
  });
});