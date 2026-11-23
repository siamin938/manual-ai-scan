import {
  existsSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

function pathOf(relativePath: string): string {
  return join(repoRoot, relativePath);
}

function read(relativePath: string): string {
  return readFileSync(pathOf(relativePath), "utf8");
}

function collectTypeScriptFiles(relativeDir: string): string[] {
  const root = pathOf(relativeDir);
  const files: string[] = [];

  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".ts")) {
        files.push(relative(repoRoot, fullPath));
      }
    }
  };

  walk(root);
  return files.sort();
}

const processIndex = read("supabase/functions/process-measurement-job/index.ts");
const processParser = read("supabase/functions/process-measurement-job/_shared/parser.ts");
const processTypes = read("supabase/functions/process-measurement-job/_shared/types.ts");
const reparseIndex = read("supabase/functions/reparse-measurements/index.ts");
const reparseParser = read("supabase/functions/reparse-measurements/_shared/parser.ts");
const reparseTypes = read("supabase/functions/reparse-measurements/_shared/types.ts");
const manifest = JSON.parse(read("supabase/EDGE_RUNTIME_CONTRACT.json")) as {
  projectId: string;
  criticalFunctions: Array<Record<string, unknown>>;
  sourceRecoveryFinding?: Record<string, unknown>;
};

function critical(slug: string): Record<string, unknown> {
  const row = manifest.criticalFunctions.find((item) => item.slug === slug);
  if (!row) throw new Error(`Missing runtime contract for ${slug}`);
  return row;
}

describe("Recovered live Edge source contract", () => {
  it("keeps all required recovered runtime source files in the foundation branch", () => {
    const required = [
      "supabase/functions/process-measurement-job/index.ts",
      "supabase/functions/process-measurement-job/_shared/http.ts",
      "supabase/functions/process-measurement-job/_shared/parser.ts",
      "supabase/functions/process-measurement-job/_shared/provider-utils.ts",
      "supabase/functions/process-measurement-job/_shared/providers/index.ts",
      "supabase/functions/process-measurement-job/_shared/providers/openai.ts",
      "supabase/functions/process-measurement-job/_shared/providers/gemini.ts",
      "supabase/functions/process-measurement-job/_shared/providers/perplexity.ts",
      "supabase/functions/process-measurement-job/_shared/safety.ts",
      "supabase/functions/process-measurement-job/_shared/supabase-env.ts",
      "supabase/functions/process-measurement-job/_shared/types.ts",
      "supabase/functions/reparse-measurements/index.ts",
      "supabase/functions/reparse-measurements/_shared/parser.ts",
      "supabase/functions/reparse-measurements/_shared/provider-utils.ts",
      "supabase/functions/reparse-measurements/_shared/supabase-env.ts",
      "supabase/functions/reparse-measurements/_shared/types.ts",
      "supabase/functions/visibility-postprocess/index.ts",
    ];

    for (const relativePath of required) {
      expect(existsSync(pathOf(relativePath)), relativePath).toBe(true);
    }
  });

  it("locks the live Parser 1.2.6 behavioral contract for both parser callers", () => {
    expect(processParser).toContain('export const PARSER_VERSION = "1.2.6";');
    expect(reparseParser).toContain('export const PARSER_VERSION = "1.2.6";');
    expect(reparseParser).toBe(processParser);
  });

  it("preserves the production worker safety and cost-cap invariants", () => {
    expect(processIndex).toContain("const MAX_ATTEMPTS = 3;");
    expect(processIndex).toContain('request.headers.get("x-internal-secret")');
    expect(processIndex).toContain("RUN_COST_CAP_REACHED");
    expect(processIndex).toContain("MONTHLY_BUDGET_REACHED");
    expect(processIndex).toContain("callProvider(job.provider, approvedRequest)");
  });

  it("preserves reparse as a bounded stored-answer path with no provider call", () => {
    expect(reparseIndex).toContain("const MAX_MEASUREMENTS = 50;");
    expect(reparseIndex).toContain('"entity-facts-v2-materialize-run"');
    expect(reparseIndex).toContain("{runId,refresh:true}");
    expect(reparseIndex).toMatch(/const\s+dryRun\s*=\s*payload\.dry_run\s*!==\s*false\s*;/u);
    expect(reparseIndex).toMatch(/api_provider_called\s*:\s*false/u);
    expect(reparseIndex).not.toMatch(/\bcallProvider\b/u);
  });

  it("makes the unrecoverable type-only provenance explicit instead of pretending it is exact", () => {
    expect(processTypes.trimStart().startsWith("// RECONSTRUCTED_COMPILE_ONLY")).toBe(true);
    expect(reparseTypes.trimStart().startsWith("// RECONSTRUCTED_COMPILE_ONLY")).toBe(true);

    for (const slug of ["process-measurement-job", "reparse-measurements"]) {
      const row = critical(slug);
      expect(row.runtimeBehaviorSourcePresentOnFoundation).toBe(true);
      expect(row.deployCandidatePresentOnFoundation).toBe(true);
      expect(row.exactOriginalSourceRecoverable).toBe(false);
      expect(row.compileOnlySourceGap).toEqual(["_shared/types.ts original text"]);
    }
  });

  it("pins the recovered source contract to the observed live versions and deployed hashes", () => {
    expect(manifest.projectId).toBe("qoirkwmnyolquvsgbian");

    expect(critical("process-measurement-job")).toMatchObject({
      liveVersion: 11,
      liveSha256: "e9e84cc7a92af2f66e2d5a9dfd6a36add3185c09eeab678835024a0b86ee1f72",
      liveVerifyJwt: false,
      liveParserVersion: "1.2.3",
    });
    expect(critical("reparse-measurements")).toMatchObject({
      liveVersion: 14,
      liveSha256: "f9b427907f754d8fda5874420dd011f4dcb1171ba1ca3e6d0928b27cab59a220",
      liveVerifyJwt: false,
      liveParserVersion: "1.2.3",
    });
    expect(critical("visibility-postprocess")).toMatchObject({
      liveVersion: 9,
      liveSha256: "b9ed58d3532825cf434b99874e59b9ed90364e9803419bbe162791382751e8f6",
      liveVerifyJwt: false,
      runtimeBehaviorSourcePresentOnFoundation: true,
    });
  });

  it("keeps the recovery policy explicit about Management API/CLI and type-only gaps", () => {
    const finding = JSON.stringify(manifest.sourceRecoveryFinding ?? {});
    expect(finding).toContain("deployed function body/unbundle");
    expect(finding).toContain("type-only");
    expect(finding).toContain("byte-identical");
  });

  it("parses every recovered TypeScript source without syntax errors", () => {
    const files = [
      ...collectTypeScriptFiles("supabase/functions/process-measurement-job"),
      ...collectTypeScriptFiles("supabase/functions/reparse-measurements"),
      "supabase/functions/visibility-postprocess/index.ts",
    ];

    for (const file of files) {
      const result = ts.transpileModule(read(file), {
        fileName: file,
        reportDiagnostics: true,
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.ESNext,
        },
      });
      const errors = (result.diagnostics ?? []).filter(
        (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
      );
      const messages = errors.map((diagnostic) =>
        ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
      );
      expect(messages, file).toEqual([]);
    }
  });
});
