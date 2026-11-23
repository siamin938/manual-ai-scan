import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("unified diagnostic server contract", () => {
  it("enforces unified-only customer measurement after a unified set exists", () => {
    const source = readFileSync(
      new URL("../../src/lib/customer-measurement.server.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain("hasUnifiedDiagnosticIntentShape");
    expect(source).toContain("isUnifiedDiagnosticSetName");
    expect(source).toContain("const newestUnifiedSet =");
    expect(source).toContain("set.name.startsWith(UNIFIED_DIAGNOSTIC_SET_PREFIX)");
    expect(source).toContain("newestUnifiedSet && questionSet.id !== newestUnifiedSet.id");
    expect(source).toContain("activeQuestions.length !== CUSTOMER_STANDARD_QUESTION_COUNT");
    expect(source).toContain("activeQuestions.map((q) => q.intent_type)");
  });

  it("uses the dashboard gateway representative run for action evidence", () => {
    const source = readFileSync(
      new URL("../../src/lib/action-opportunity-evidence.server.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain("const sourceRunId = gateway.data.scope.runId;");
    expect(source).toContain('.eq("source_run_id", sourceRunId)');
    expect(source).not.toContain('.from("measurement_runs")');
  });
});
