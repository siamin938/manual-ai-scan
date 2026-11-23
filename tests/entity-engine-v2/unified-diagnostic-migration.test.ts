import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

function source(path: string): string {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

describe("unified diagnostic migration contract", () => {
  it("keeps legacy representative data visible until the first unified run completes", () => {
    const gateway = source("src/lib/entity-facts-v2-read-gateway.server.ts");
    const comparison = source("src/lib/entity-facts-v2-comparison.server.ts");

    for (const text of [gateway, comparison]) {
      expect(text).toContain("UNIFIED_DIAGNOSTIC_SET_PREFIX");
      expect(text).toContain("currentUnifiedSet");
      expect(text).toContain("previousRepresentativeRun");
      expect(text).toContain('.eq("question_set_id", currentUnifiedSet.id)');
      expect(text).toContain('.eq("status", "completed")');
    }

    expect(gateway).toContain(
      "A newly created unified set does not erase the last representative result.",
    );
    expect(comparison).toContain(
      "A prepared unified set becomes representative only after its first completed run.",
    );
  });

  it("shows a migration-pending dashboard CTA without relabeling legacy results", () => {
    const dashboard = source("src/routes/_authenticated/dashboard.tsx");

    expect(dashboard).toContain("hasCompletedUnifiedRun");
    expect(dashboard).toContain("unifiedTransitionPending");
    expect(dashboard).toContain("새 통합 AI 진단 질문이 준비되었습니다.");
    expect(dashboard).toContain("첫 통합 24문항 측정을 완료하기 전까지는 기존 대표 진단 결과");
    expect(dashboard).toContain("첫 통합 진단 측정하기");
    expect(dashboard).toContain('to="/runs"');
    expect(dashboard).toContain(
      'const isUnifiedDiagnostic =\n    hasCompletedUnifiedRun ||',
    );
    expect(dashboard).toContain("!hasCompletedUnifiedRun");
  });

  it("uses a durable completed-run check on the questions screen", () => {
    const questions = source("src/routes/_authenticated/questions.tsx");

    expect(questions).toContain('queryKey: ["completed-unified-run"');
    expect(questions).toContain('.eq("status", "completed")');
    expect(questions).toContain("const hasCompletedUnifiedRun = !!completedUnifiedRun");
    expect(questions).toContain("첫 측정 필요");
    expect(questions).toContain("대표 진단 사용 중");
    expect(questions).toContain("첫 통합 진단 측정하기");
    expect(questions).toContain("이전 맞춤·기본 진단 기록은 측정 이력에 그대로 보존됩니다.");
  });

  it("keeps new customer measurements on the unified set while preserving legacy history", () => {
    const runs = source("src/routes/_authenticated/runs.index.tsx");

    expect(runs).toContain("selectCustomerRunQuestionSets");
    expect(runs).toContain("newestUnifiedSet");
    expect(runs).toContain("이전 맞춤 진단");
    expect(runs).toContain("이전 기본 진단");
    expect(runs).toContain("대표 진단");
  });
});
