import { describe, expect, it } from "vitest";
import {
  choosePreferredRunQuestionSetId,
  formatAutoRunName,
  getRunQuestionSetKind,
  isCustomRunQuestionSet,
} from "../../src/routes/_authenticated/runs.index";
import {
  CANONICALIZATION_VERSION_CONFLICT,
  resolveCanonicalizationVersion,
} from "../../src/lib/canonicalization-version.helpers";

describe("run question set selection", () => {
  it("recognizes only the v0.1 custom prefix", () => {
    expect(isCustomRunQuestionSet("맞춤 질문 · 카스페이스 구로점 · 2026-09-25")).toBe(true);
    expect(isCustomRunQuestionSet("Market 맞춤 질문")).toBe(false);
  });

  it("prefers a unified diagnostic set over legacy custom and baseline sets", () => {
    expect(
      choosePreferredRunQuestionSetId([
        { id: "new-custom", name: "맞춤 질문 · 새 세트" },
        { id: "unified", name: "AI 진단 질문 · 업체 · 2026-09-26" },
        { id: "baseline", name: "기본 질문" },
      ]),
    ).toBe("unified");
  });

  it("falls back to the newest legacy custom set when no unified set exists", () => {
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

  it("distinguishes unified, legacy custom, baseline, and other sets", () => {
    expect(getRunQuestionSetKind("AI 진단 질문 · 업체 · 2026-09-26", 24)).toBe("unified");
    expect(getRunQuestionSetKind("맞춤 질문 · 업체", 8)).toBe("custom");
    expect(getRunQuestionSetKind("기본 질문", 24)).toBe("baseline");
    expect(getRunQuestionSetKind("Market 질문", 8)).toBe("other");
  });

  it("formats the auto run name by diagnostic kind", () => {
    expect(formatAutoRunName("카스페이스 구로점", "unified", "2026-09-26")).toBe(
      "카스페이스 구로점 AI 진단 2026-09-26",
    );
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

describe("run detail canonicalization version", () => {
  it("returns null when no canonicalization rows exist", () => {
    expect(resolveCanonicalizationVersion([])).toBeNull();
  });

  it("accepts a single stored resolver version", () => {
    expect(
      resolveCanonicalizationVersion([
        { resolver_version: "0.1.0" },
        { resolver_version: "0.1.0" },
      ]),
    ).toBe("0.1.0");
    expect(
      resolveCanonicalizationVersion([
        { resolver_version: "0.1.1" },
        { resolver_version: "0.1.1" },
      ]),
    ).toBe("0.1.1");
  });

  it("fails closed when resolver versions are mixed", () => {
    expect(
      resolveCanonicalizationVersion([
        { resolver_version: "0.1.0" },
        { resolver_version: "0.1.1" },
      ]),
    ).toBe(CANONICALIZATION_VERSION_CONFLICT);
  });

  it("removes the fixed resolver filter and keeps the conflict notice", async () => {
    const { readFileSync } = await import("node:fs");
    const detailSource = readFileSync(
      new URL("../../src/routes/_authenticated/runs.$runId.tsx", import.meta.url),
      "utf8",
    );

    expect(detailSource).not.toContain(
      'import { RESOLVER_VERSION } from "@/lib/entity-canonical-resolver"',
    );
    expect(detailSource).not.toContain('.eq("resolver_version", RESOLVER_VERSION)');
    expect(detailSource).toContain("resolver_version");
    expect(detailSource).toContain(
      "이 측정의 업체 정리 버전이 여러 개 확인되어 업체 목록을 표시하지 않습니다.",
    );
  });
});