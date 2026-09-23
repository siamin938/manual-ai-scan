import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "scripts/sql/measurement-run-diagnostic-scope-migration-candidate.sql"),
  "utf8",
);
const gateway = readFileSync(
  resolve(process.cwd(), "src/lib/entity-facts-v2-read-gateway.server.ts"),
  "utf8",
);
const customerMeasurement = readFileSync(
  resolve(process.cwd(), "src/lib/customer-measurement.server.ts"),
  "utf8",
);
const baseline = readFileSync(
  resolve(process.cwd(), "src/lib/experiments.baseline.server.ts"),
  "utf8",
);
const followup = readFileSync(
  resolve(process.cwd(), "src/lib/experiments.followup.server.ts"),
  "utf8",
);
const generatedTypes = readFileSync(
  resolve(process.cwd(), "src/integrations/supabase/types.ts"),
  "utf8",
);
const report = JSON.parse(
  readFileSync(
    resolve(
      process.cwd(),
      "scripts/reports/measurement-run-diagnostic-scope-classification-v01.json",
    ),
    "utf8",
  ),
) as {
  proposedSummary: {
    allRuns: number;
    customer: number;
    internalQa: number;
    completedStandaloneInternalQa: number;
    representativeBusinesses: number;
  };
  reviewedInternalQaStandaloneRuns: Array<{ runId: string }>;
  representativeRunsAfterClassification: Array<{
    runId: string;
    measurementCount: number;
    hasV2: boolean;
  }>;
};

describe("measurement run diagnostic scope contract", () => {
  it("adds one explicit, constrained, backward-compatible scope column", () => {
    expect(migration).toContain(
      "ADD COLUMN IF NOT EXISTS diagnostic_scope text NOT NULL DEFAULT 'customer'",
    );
    expect(migration).toContain(
      "CHECK (diagnostic_scope IN ('customer','internal_qa'))",
    );
    expect(migration).toContain(
      "Runtime never infers scope from",
    );
    expect(migration).not.toMatch(/feed36b9|c2d55341|60013c1d/u);
  });

  it("makes customer creation and draft reuse explicitly customer-scoped", () => {
    expect(customerMeasurement).toContain(
      'diagnostic_scope: "customer"',
    );
    expect(customerMeasurement).toContain(
      '.eq("diagnostic_scope", "customer")',
    );
  });

  it("marks experiment-created runs as internal QA", () => {
    expect(baseline).toContain('diagnostic_scope: "internal_qa"');
    expect(followup).toContain('diagnostic_scope: "internal_qa"');
  });

  it("makes the v2 representative gateway select customer scope only", () => {
    const selectionStart = gateway.indexOf(
      "// Keep representative-run semantics",
    );
    const selectionEnd = gateway.indexOf(
      "const v2Admin",
      selectionStart,
    );
    const selection = gateway.slice(selectionStart, selectionEnd);

    expect(selection).toContain('.eq("diagnostic_scope", "customer")');
    expect(selection).not.toMatch(/question_count|total_jobs.*24|smoke|스모크/u);
  });

  it("keeps generated types aligned with the non-null schema", () => {
    const start = generatedTypes.indexOf("measurement_runs: {");
    const end = generatedTypes.indexOf("Relationships:", start);
    const block = generatedTypes.slice(start, end);

    expect(block).toContain("diagnostic_scope: string");
    expect(block).toContain("diagnostic_scope?: string");
    expect(block).not.toContain("diagnostic_scope: string | null");
  });

  it("records a reviewed historical classification with safe representative results", () => {
    expect(report.proposedSummary).toEqual({
      allRuns: 28,
      customer: 17,
      internalQa: 11,
      completedStandaloneInternalQa: 7,
      representativeBusinesses: 8,
    });
    expect(report.reviewedInternalQaStandaloneRuns).toHaveLength(7);
    expect(
      new Set(
        report.reviewedInternalQaStandaloneRuns.map((item) => item.runId),
      ).size,
    ).toBe(7);
    expect(report.representativeRunsAfterClassification).toHaveLength(8);
    expect(
      report.representativeRunsAfterClassification.every(
        (item) => item.measurementCount === 24 && item.hasV2,
      ),
    ).toBe(true);
    expect(
      report.representativeRunsAfterClassification.some(
        (item) =>
          item.runId === "feed36b9-a1d9-419f-8408-98832d6ec428",
      ),
    ).toBe(false);
  });
});
