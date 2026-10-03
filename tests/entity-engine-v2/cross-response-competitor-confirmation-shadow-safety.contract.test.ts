import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const shadowServer = readFileSync(
  resolve(
    process.cwd(),
    "src/lib/cross-response-competitor-confirmation.shadow.server.ts",
  ),
  "utf8",
);

const readGatewayServer = readFileSync(
  resolve(process.cwd(), "src/lib/entity-facts-v2-read-gateway.server.ts"),
  "utf8",
);

const shadowPolicy = readFileSync(
  resolve(
    process.cwd(),
    "src/lib/cross-response-competitor-confirmation.shadow.ts",
  ),
  "utf8",
);

describe("cross-response competitor shadow safety contract", () => {
  it("is read-only and does not write or mutate stored measurement truth", () => {
    expect(shadowServer).toContain(
      "fetchCrossResponseCompetitorShadowSupplement",
    );
    expect(shadowServer).toContain("affectsTargetMetrics: false");
    expect(shadowServer).not.toContain(".insert(");
    expect(shadowServer).not.toContain(".update(");
    expect(shadowServer).not.toContain(".upsert(");
    expect(shadowServer).not.toContain(".delete(");
    expect(shadowServer).not.toContain("targetSeen");
    expect(shadowServer).not.toContain("targetBestPosition");
  });

  it("is not wired into the customer v2 read gateway yet", () => {
    expect(readGatewayServer).not.toContain(
      "cross-response-competitor-confirmation.shadow.server",
    );
    expect(readGatewayServer).not.toContain(
      "fetchCrossResponseCompetitorShadowSupplement",
    );
  });

  it("uses the shared source-domain classifier in both the shadow policy and v2 server reads", () => {
    expect(shadowPolicy).toContain('from "./source-domain-classifier"');
    expect(readGatewayServer).toContain(
      'from "@/lib/source-domain-classifier"',
    );
    expect(readGatewayServer).toContain("isInfrastructureSourceDomain");
  });
});
