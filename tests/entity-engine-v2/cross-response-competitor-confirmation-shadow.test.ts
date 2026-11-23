import { describe, expect, it } from "vitest";
import {
  CROSS_RESPONSE_COMPETITOR_CONFIRMATION_SHADOW_VERSION,
  crossResponseCompetitorNamesPotentiallySameBusiness,
  evaluateCrossResponseCompetitorConfirmationShadow,
  type CrossResponseCompetitorShadowCandidate,
  type ExistingV2CompetitorShadowEvidence,
} from "../../src/lib/cross-response-competitor-confirmation.shadow";

function candidate(
  overrides: Partial<CrossResponseCompetitorShadowCandidate> = {},
): CrossResponseCompetitorShadowCandidate {
  return {
    canonicalKey: "auto:example",
    displayName: "예시업체",
    verifierConfirmedBusiness: true,
    distinctResponseCount: 2,
    corroboratingDomain: "example.com",
    corroboratingDomainResponseCount: 2,
    directAttributionCount: 1,
    ...overrides,
  };
}

function existing(
  overrides: Partial<ExistingV2CompetitorShadowEvidence> = {},
): ExistingV2CompetitorShadowEvidence {
  return {
    canonicalKey: "auto:existing",
    displayName: "기존업체",
    corroboratingDomains: ["existing.example"],
    ...overrides,
  };
}

describe("cross-response competitor confirmation shadow v0.1", () => {
  it("keeps the version explicit and shadow-only", () => {
    expect(CROSS_RESPONSE_COMPETITOR_CONFIRMATION_SHADOW_VERSION).toBe("0.1");
  });

  it("promotes the 국스월드 regression fixture without any business-specific rule", () => {
    const result = evaluateCrossResponseCompetitorConfirmationShadow({
      candidate: candidate({
        canonicalKey: "auto:국스월드",
        displayName: "국스월드",
        distinctResponseCount: 5,
        corroboratingDomain: "kugs.net",
        corroboratingDomainResponseCount: 5,
        directAttributionCount: 1,
      }),
      existingV2Competitors: [
        existing({
          canonicalKey: "auto:퀀텀팩토리서초점",
          displayName: "퀀텀팩토리 서초점",
          corroboratingDomains: ["carcarescenter.com"],
        }),
      ],
    });

    expect(result).toEqual({
      version: "0.1",
      decision: "promote_candidate",
      reasons: ["CROSS_RESPONSE_EVIDENCE_GATE_PASS"],
      collisionCanonicalKeys: [],
    });
  });

  it("holds 모먼트 for merge review when the same strong domain supports a related existing v2 name", () => {
    const result = evaluateCrossResponseCompetitorConfirmationShadow({
      candidate: candidate({
        canonicalKey: "auto:모먼트",
        displayName: "모먼트",
        distinctResponseCount: 3,
        corroboratingDomain: "momentcarcare.co.kr",
        corroboratingDomainResponseCount: 3,
        directAttributionCount: 1,
      }),
      existingV2Competitors: [
        existing({
          canonicalKey: "auto:모먼트카케어",
          displayName: "모먼트 카케어",
          corroboratingDomains: ["https://www.momentcarcare.co.kr"],
        }),
      ],
    });

    expect(result.decision).toBe("merge_review");
    expect(result.reasons).toEqual(["POSSIBLE_SAME_BUSINESS_COLLISION"]);
    expect(result.collisionCanonicalKeys).toEqual(["auto:모먼트카케어"]);
  });

  it("also promotes a repeated direct-domain fixture like T 스타일 랩", () => {
    const result = evaluateCrossResponseCompetitorConfirmationShadow({
      candidate: candidate({
        canonicalKey: "auto:t스타일랩",
        displayName: "T 스타일 랩",
        distinctResponseCount: 2,
        corroboratingDomain: "tstylelab.com",
        corroboratingDomainResponseCount: 2,
        directAttributionCount: 1,
      }),
      existingV2Competitors: [],
    });

    expect(result.decision).toBe("promote_candidate");
  });

  it("rejects a one-off false-positive-shaped phrase even if a verifier flag exists", () => {
    const result = evaluateCrossResponseCompetitorConfirmationShadow({
      candidate: candidate({
        canonicalKey: "auto:블랙박스나오토프렁크설치시배선작업방식",
        displayName: "블랙박스나 오토프렁크 설치 시 배선 작업 방식",
        distinctResponseCount: 1,
        corroboratingDomain: "example.com",
        corroboratingDomainResponseCount: 1,
      }),
      existingV2Competitors: [],
    });

    expect(result.decision).toBe("reject");
    expect(result.reasons).toEqual(["INSUFFICIENT_DISTINCT_RESPONSES"]);
  });

  it("rejects shared or aggregator domains even with repeat evidence", () => {
    const result = evaluateCrossResponseCompetitorConfirmationShadow({
      candidate: candidate({
        distinctResponseCount: 5,
        corroboratingDomain: "pf.kakao.com",
        corroboratingDomainResponseCount: 5,
        directAttributionCount: 3,
      }),
      existingV2Competitors: [],
    });

    expect(result.decision).toBe("reject");
    expect(result.reasons).toEqual(["SHARED_OR_AGGREGATOR_DOMAIN"]);
  });

  it("requires at least one direct attribution and repeated domain support", () => {
    expect(
      evaluateCrossResponseCompetitorConfirmationShadow({
        candidate: candidate({
          corroboratingDomainResponseCount: 1,
        }),
        existingV2Competitors: [],
      }),
    ).toMatchObject({
      decision: "reject",
      reasons: ["INSUFFICIENT_REPEAT_DOMAIN_SUPPORT"],
    });

    expect(
      evaluateCrossResponseCompetitorConfirmationShadow({
        candidate: candidate({
          directAttributionCount: 0,
        }),
        existingV2Competitors: [],
      }),
    ).toMatchObject({
      decision: "reject",
      reasons: ["DIRECT_ATTRIBUTION_MISSING"],
    });
  });

  it("does not promote non-auto or unverified candidates", () => {
    expect(
      evaluateCrossResponseCompetitorConfirmationShadow({
        candidate: candidate({ canonicalKey: "business:123" }),
        existingV2Competitors: [],
      }),
    ).toMatchObject({
      decision: "reject",
      reasons: ["NOT_UNREGISTERED_AUTO_ENTITY"],
    });

    expect(
      evaluateCrossResponseCompetitorConfirmationShadow({
        candidate: candidate({ verifierConfirmedBusiness: false }),
        existingV2Competitors: [],
      }),
    ).toMatchObject({
      decision: "reject",
      reasons: ["VERIFIER_NOT_CONFIRMED"],
    });
  });

  it("returns already_confirmed instead of duplicating an existing v2 canonical key", () => {
    const result = evaluateCrossResponseCompetitorConfirmationShadow({
      candidate: candidate({
        canonicalKey: "auto:existing",
      }),
      existingV2Competitors: [existing()],
    });

    expect(result).toMatchObject({
      decision: "already_confirmed",
      reasons: ["ALREADY_IN_V2"],
    });
  });

  it("uses conservative same-business name collision checks", () => {
    expect(
      crossResponseCompetitorNamesPotentiallySameBusiness(
        "모먼트",
        "모먼트 카케어",
      ),
    ).toBe(true);
    expect(
      crossResponseCompetitorNamesPotentiallySameBusiness(
        "카스페이스 구로점",
        "카스페이스 구로 본점",
      ),
    ).toBe(true);
    expect(
      crossResponseCompetitorNamesPotentiallySameBusiness(
        "마젠타",
        "케이엔오토웍스 남양주점",
      ),
    ).toBe(false);
    expect(
      crossResponseCompetitorNamesPotentiallySameBusiness("AB", "AB 모터스"),
    ).toBe(false);
  });
});
