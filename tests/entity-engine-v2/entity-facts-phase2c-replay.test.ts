import { describe, expect, it } from "vitest";
import {
  replayPhase2CDataset,
  type Phase2CReplayDataset,
  type Phase2CReplayDatasetRow,
} from "../../scripts/entity-facts-phase2c-replay";

const TARGET_ID = "c9cb39d5-9f04-46ec-8018-14156670446d";

function row(
  index: number,
  overrides: Partial<Phase2CReplayDatasetRow> = {},
): Phase2CReplayDatasetRow {
  return {
    measurementId: `m${index}`,
    runId: "run-1",
    businessId: TARGET_ID,
    questionId: `q${index}`,
    questionText: `질문 ${index}`,
    intentType: "local",
    valid: true,
    responseText: "- 레이노 개봉점",
    rawParser: {
      wasClientMentioned: false,
      clientPosition: null,
    },
    target: {
      id: TARGET_ID,
      name: "카스페이스 구로점",
      aliases: ["카스페이스구로점"],
      fullAddress: "서울 구로구 경인로53나길 27 1층",
      canonicalNaverPlaceId:
        "https://map.naver.com/p/entry/place/1069740203",
      verifiedConcreteOfficialUrls: [],
    },
    registeredBusinesses: [
      {
        id: TARGET_ID,
        name: "카스페이스 구로점",
        aliases: ["카스페이스구로점"],
        fullAddress: "서울 구로구 경인로53나길 27 1층",
        canonicalNaverPlaceId:
          "https://map.naver.com/p/entry/place/1069740203",
        verifiedConcreteOfficialUrls: [],
      },
    ],
    storedMentions: [
      {
        mentionId: `mention-${index}`,
        displayName: "레이노 개봉점",
        position: 1,
        canonicalKey: "auto:레이노개봉점",
      },
    ],
    attributions: [],
    ...overrides,
  };
}

function dataset(rows: Phase2CReplayDatasetRow[]): Phase2CReplayDataset {
  return {
    version: "entity-facts-phase2c-export-v0.1",
    publicIdentities: [
      {
        name: "카스페이스 구로 본점",
        aliases: ["카스페이스 구로점"],
        fullAddress: "서울 구로구 경인로53나길 27 1층",
      },
    ],
    rows,
  };
}

describe("Phase 2C historical dataset replay v0.1", () => {
  it("keeps the current raw metric inside the Carspace-like uncertainty interval", () => {
    const rows = Array.from({ length: 24 }, (_, index) => {
      if (index === 0) {
        return row(index + 1, {
          responseText: "- 카스페이스 구로점",
          rawParser: {
            wasClientMentioned: true,
            clientPosition: 2,
          },
          storedMentions: [
            {
              mentionId: "target",
              displayName: "카스페이스 구로점",
              matchedBusinessId: TARGET_ID,
              matchedAlias: "카스페이스구로점",
              position: 2,
              canonicalKey: `business:${TARGET_ID}`,
            },
          ],
        });
      }
      if (index >= 1 && index <= 5) {
        return row(index + 1, {
          responseText: "- 카스페이스 구로 본점",
          storedMentions: [
            {
              mentionId: `old-${index}`,
              displayName: "카스페이스 구로 본점",
              position: 1,
              canonicalKey: "auto:카스페이스구로본점",
            },
          ],
        });
      }
      return row(index + 1);
    });

    const report = replayPhase2CDataset(dataset(rows));
    const run = report.runs[0]!;

    expect(run.current.visibilityRatePct).toBe(4.17);
    expect(run.proposed.confirmedMentionCount).toBe(1);
    expect(run.proposed.unresolvedTargetCount).toBe(5);
    expect(run.proposed.visibilityLowerBoundPct).toBe(4.17);
    expect(run.proposed.visibilityUpperBoundPct).toBe(25);
    expect(run.proposed.top3UncertainCount).toBe(5);
    expect(run.currentVisibilityInsideProposedBounds).toBe(true);
    expect(report.releaseGate.ok).toBe(true);
    expect(report.releaseGate.blockingIssueCount).toBe(0);
  });

  it("flags a raw parser metric that falls outside authoritative proposed bounds", () => {
    const report = replayPhase2CDataset(
      dataset([
        row(1, {
          rawParser: {
            wasClientMentioned: true,
            clientPosition: 1,
          },
          responseText: "- 레이노 개봉점",
        }),
      ]),
    );

    expect(report.runs[0]?.current.visibilityRatePct).toBe(100);
    expect(report.runs[0]?.proposed.visibilityUpperBoundPct).toBe(0);
    expect(report.runs[0]?.currentVisibilityInsideProposedBounds).toBe(false);
    expect(report.summary.visibilityOutsideBoundsRunCount).toBe(1);
    expect(report.releaseGate.ok).toBe(false);
    expect(report.releaseGate.issues.map((item) => item.code)).toEqual(
      expect.arrayContaining([
        "CURRENT_VISIBILITY_OUTSIDE_PROPOSED_BOUNDS",
        "CURRENT_TOP3_OUTSIDE_PROPOSED_BOUNDS",
      ]),
    );
  });

  it("groups multiple runs independently", () => {
    const report = replayPhase2CDataset(
      dataset([
        row(1),
        row(2, {
          runId: "run-2",
          businessId: "22222222-2222-4222-8222-222222222222",
          target: {
            id: "22222222-2222-4222-8222-222222222222",
            name: "타이어프로 봉일천점",
            aliases: [],
          },
          registeredBusinesses: [
            {
              id: "22222222-2222-4222-8222-222222222222",
              name: "타이어프로 봉일천점",
              aliases: [],
            },
          ],
        }),
      ]),
    );

    expect(report.summary.runCount).toBe(2);
    expect(report.runs.map((item) => item.runId)).toEqual([
      "run-1",
      "run-2",
    ]);
  });

  it("evaluates source replay and keeps zero sources explicit when no attribution exists", () => {
    const report = replayPhase2CDataset(dataset([row(1)]));
    expect(report.summary.sourceReplayStatus).toBe("evaluated");
    expect(report.runs[0]?.proposed.sourceReplayStatus).toBe("evaluated");
    expect(report.runs[0]?.proposed.sourceDomainCount).toBe(0);
    expect(report.runs[0]?.proposed.acceptedAttributionCount).toBe(0);
  });

  it("feeds stored target attribution through source replay into run source facts", () => {
    const report = replayPhase2CDataset(
      dataset([
        row(1, {
          responseText: "- 카스페이스 구로점",
          storedMentions: [
            {
              mentionId: "target-mention",
              displayName: "카스페이스 구로점",
              matchedBusinessId: TARGET_ID,
              matchedAlias: "카스페이스구로점",
              position: 1,
              canonicalKey: `business:${TARGET_ID}`,
            },
          ],
          attributions: [
            {
              attributionId: "source-1",
              measurementMentionId: "target-mention",
              canonicalKey: `business:${TARGET_ID}`,
              domain: "example.com",
              url: "https://example.com/page",
              attributionLevel: "direct",
              evidence: {},
              citationStartIndex: 20,
              entityEndIndex: 12,
            },
          ],
        }),
      ]),
    );

    expect(report.summary.sourceReplayStatus).toBe("evaluated");
    expect(report.summary.acceptedAttributionCount).toBe(1);
    expect(report.runs[0]?.proposed.sourceDomainCount).toBe(1);
    expect(report.runs[0]?.proposed.acceptedAttributionCount).toBe(1);
    expect(report.runs[0]?.proposed.sourcePartialMeasurementCount).toBe(0);
  });

  it("preserves invalid measurements in total count but excludes them from current denominator", () => {
    const report = replayPhase2CDataset(
      dataset([
        row(1, {
          valid: false,
          responseText: "",
        }),
        row(2),
      ]),
    );

    expect(report.summary.measurementCount).toBe(2);
    expect(report.summary.validMeasurementCount).toBe(1);
    expect(report.summary.invalidMeasurementCount).toBe(1);
    expect(report.runs[0]?.current.validCount).toBe(1);
  });
});
