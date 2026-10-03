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
  it("remains read-only and cannot mutate stored measurement truth", () => {
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

  it("is wired only at the customer read layer with exact baseline binding", () => {
    expect(readGatewayServer).toContain(
      "fetchCrossResponseCompetitorShadowSupplement",
    );
    expect(readGatewayServer).toContain(
      "mergeCrossResponsePromotedCompetitorsForReadLayer",
    );
    expect(readGatewayServer).toContain("expectedRunId: run.id");
    expect(readGatewayServer).toContain("expectedAggregateId: storage.id");
    expect(readGatewayServer).toContain(
      "expectedAggregateHash: storage.aggregate_hash",
    );
    expect(readGatewayServer).not.toContain(
      "gatewayResponse.data.overview =",
    );
    expect(readGatewayServer).not.toContain(
      "gatewayResponse.data.questionGroups =",
    );
    expect(readGatewayServer).not.toContain(
      "gatewayResponse.data.questionAreas =",
    );
    expect(readGatewayServer).toContain(
      "competitorShadowSupplement?.mergeReviewCandidates ?? []",
    );
    expect(readGatewayServer).toContain(
      "mergeCanonicalAliases[row.canonicalKey]",
    );
    expect(readGatewayServer).not.toContain(
      "gatewayResponse.data.competitors.push(...competitorShadowSupplement.mergeReviewCandidates",
    );
    expect(readGatewayServer).not.toContain(
      "gatewayResponse.data.competitors = competitorShadowSupplement.mergeReviewCandidates",
    );
  });

  it("keeps the runtime materialization path outside the supplement module", () => {
    expect(shadowServer).not.toContain("runtime-materialization");
    expect(shadowServer).not.toContain("buildEntityFactsV2RuntimeMaterialization");
    expect(shadowServer).toContain(
      "mergeCrossResponsePromotedCompetitorsForReadLayer",
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
