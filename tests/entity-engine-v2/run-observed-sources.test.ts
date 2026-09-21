import { describe, expect, it } from "vitest";
import { buildRunObservedSourcesV2 } from "../../supabase/functions/_shared/entity-engine-v2/run-observed-sources";
import type { AcceptedReplayAttributionV2 } from "../../supabase/functions/_shared/entity-engine-v2/run-source-replay";

function accepted(
  overrides: Partial<AcceptedReplayAttributionV2> = {},
): AcceptedReplayAttributionV2 {
  return {
    measurementId: "m1",
    attributionId: "a1",
    entityRef: "entity-1",
    canonicalKey: "auto:레이노개봉점",
    side: "other",
    domain: "hunnytip.kr",
    url: "https://hunnytip.kr/example",
    evidenceTier: "near_section",
    ...overrides,
  };
}

describe("Run observed sources v0.1", () => {
  it("preserves the KASPACE competitor-source signal without inventing a target link", () => {
    const result = buildRunObservedSourcesV2([
      accepted({
        measurementId: "m1",
        attributionId: "rayno-1",
        canonicalKey: "auto:레이노개봉점",
      }),
      accepted({
        measurementId: "m2",
        attributionId: "rayno-2",
        canonicalKey: "auto:레이노개봉점",
      }),
      accepted({
        measurementId: "m1",
        attributionId: "llumar-1",
        canonicalKey: "auto:루마썬팅오류점",
      }),
    ]);

    expect(result).toEqual([
      {
        domain: "hunnytip.kr",
        responseCount: 2,
        targetResponseCount: 0,
        otherResponseCount: 2,
        attributionCount: 3,
        entities: [
          {
            canonicalKey: "auto:레이노개봉점",
            side: "other",
            responseCount: 2,
            attributionCount: 2,
            directResponseCount: 0,
            nearSectionResponseCount: 2,
          },
          {
            canonicalKey: "auto:루마썬팅오류점",
            side: "other",
            responseCount: 1,
            attributionCount: 1,
            directResponseCount: 0,
            nearSectionResponseCount: 1,
          },
        ],
      },
    ]);
  });

  it("keeps target and competitor links distinct when they share one source domain", () => {
    const targetKey = "business:11111111-1111-4111-8111-111111111111";
    const result = buildRunObservedSourcesV2([
      accepted({
        measurementId: "m1",
        attributionId: "target-1",
        canonicalKey: targetKey,
        side: "target",
        domain: "shared.example",
        evidenceTier: "direct",
      }),
      accepted({
        measurementId: "m2",
        attributionId: "other-1",
        canonicalKey: "auto:competitor",
        side: "other",
        domain: "shared.example",
        evidenceTier: "direct",
      }),
    ]);

    expect(result).toEqual([
      {
        domain: "shared.example",
        responseCount: 2,
        targetResponseCount: 1,
        otherResponseCount: 1,
        attributionCount: 2,
        entities: [
          {
            canonicalKey: targetKey,
            side: "target",
            responseCount: 1,
            attributionCount: 1,
            directResponseCount: 1,
            nearSectionResponseCount: 0,
          },
          {
            canonicalKey: "auto:competitor",
            side: "other",
            responseCount: 1,
            attributionCount: 1,
            directResponseCount: 1,
            nearSectionResponseCount: 0,
          },
        ],
      },
    ]);
  });

  it("deduplicates response counts while preserving attribution counts", () => {
    const result = buildRunObservedSourcesV2([
      accepted({
        measurementId: "m1",
        attributionId: "a1",
        domain: "www.example.com",
        evidenceTier: "direct",
      }),
      accepted({
        measurementId: "m1",
        attributionId: "a2",
        domain: "example.com",
        evidenceTier: "near_section",
      }),
    ]);

    expect(result[0]).toMatchObject({
      domain: "example.com",
      responseCount: 1,
      targetResponseCount: 0,
      otherResponseCount: 1,
      attributionCount: 2,
    });
    expect(result[0]?.entities[0]).toMatchObject({
      canonicalKey: "auto:레이노개봉점",
      responseCount: 1,
      attributionCount: 2,
      directResponseCount: 1,
      nearSectionResponseCount: 1,
    });
  });
});
