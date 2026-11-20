import { beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { BroadCompetitorEvidence } from "../../src/components/dashboard-evidence-panels";
import type { EntityFactsV2ReadBroadSearchObservationDTO } from "../../src/lib/entity-facts-v2-read-gateway.types";

vi.mock("react", async (importOriginal) => ({
  ...await importOriginal<typeof import("react")>(),
  useState: vi.fn((initial: unknown) => [typeof initial === "function" ? initial() : initial, vi.fn()]),
}));

const observation: EntityFactsV2ReadBroadSearchObservationDTO = {
  version: "0.2", validCount: 8, targetConfirmedCount: 0, targetTop3Count: 0,
  targetIndependentSourceResponseCount: 0, targetIndependentSources: [],
  singleObservationCompetitors: [{ name: "공개 테스트 업체", responseCount: 1, questionCount: 1, intentCount: 1, top3ResponseCount: 0, strongestIndependentSource: null }],
  repeatedCompetitors: [], observedCompetitorCount: 1, independentWebLinkedCompetitorCount: 0,
  repeatedIndependentWebLinkedCompetitorCount: 0, sourcePatterns: [],
};

describe("broad competitor initial selection", () => {
  beforeEach(() => vi.mocked(useState).mockClear());

  it("defaults to single when the server supplies a single-observation group", () => {
    BroadCompetitorEvidence({ observation });
    expect(vi.mocked(useState).mock.results[0]?.value?.[0]).toBe("single");
  });

  it("defaults to repeated when the single-observation group is empty", () => {
    BroadCompetitorEvidence({ observation: { ...observation, singleObservationCompetitors: [], repeatedCompetitors: observation.singleObservationCompetitors } });
    expect(vi.mocked(useState).mock.results[0]?.value?.[0]).toBe("repeated");
  });
});