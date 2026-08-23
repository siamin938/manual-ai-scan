import { describe, expect, it } from "vitest";
import {
  ENTITY_VERIFIER_VERSION,
  buildEntityVerificationRows,
  isVerifiedBusinessMention,
  summarizeEntityVerificationRows,
  verifyEntityMention,
  type EntityVerificationInput,
} from "./entity-verification";

function mention(overrides: Partial<EntityVerificationInput>): EntityVerificationInput {
  return {
    mentionId: "m1",
    measurementId: "x1",
    matchedBusinessId: null,
    displayName: "",
    entityKind: "specific_business",
    specificity: "confirmed",
    countAsConfirmedBusiness: true,
    resolutionConfidence: "high",
    ...overrides,
  };
}

describe("entity verifier v0.1", () => {
  it("keeps registered business linkage confirmed", () => {
    const r = verifyEntityMention(mention({ matchedBusinessId: "b1", displayName: "커스텀개러지" }));
    expect(r.verificationStatus).toBe("confirmed_business");
    expect(r.verifiedCountAsBusiness).toBe(true);
    expect(r.confidence).toBe("high");
  });

  it("rejects heading/criteria phrases", () => {
    for (const name of ["우선 고려할 곳", "선택 기준", "추천 기준", "확인 사항", "주행성능 위주"]) {
      const r = verifyEntityMention(mention({ displayName: name }));
      expect(r.verificationStatus, name).toBe("rejected_non_business");
      expect(r.verifiedCountAsBusiness).toBe(false);
    }
  });

  it("rejects sentence-like candidates", () => {
    const r = verifyEntityMention(
      mention({
        displayName: "작업 후 순정 서비스센터 보증에 영향을 줄 수 있는 부분이 있나요",
      }),
    );
    expect(r.verificationStatus).toBe("rejected_non_business");
    expect(r.verifiedEntityKind).toBe("advice");
  });

  it("classifies brand service networks as brand_network", () => {
    const r = verifyEntityMention(mention({ displayName: "르노코리아 공식 서비스 네트워크" }));
    expect(r.verifiedEntityKind).toBe("brand_network");
    expect(r.verificationStatus).toBe("rejected_non_business");
    expect(r.verifiedCountAsBusiness).toBe(false);
  });

  it("confirms real shop candidates with intrinsic evidence", () => {
    const names = [
      "가르시아 팩토리",
      "답모터스",
      "코스모모터스",
      "평택 코스모모터스",
      "진접정비센터",
      "르노코리아 서비스센터 진접정비",
      "남양주 팀카본 수입차정비센터 공임나라 협력점",
    ];
    for (const name of names) {
      const r = verifyEntityMention(mention({ displayName: name }));
      expect(r.verificationStatus, name).toBe("confirmed_business");
      expect(r.verifiedCountAsBusiness, name).toBe(true);
    }
  });

  it("never promotes ambiguous originals", () => {
    const r = verifyEntityMention(
      mention({ displayName: "쇼바팩토리", entityKind: "ambiguous", specificity: "probable", countAsConfirmedBusiness: false }),
    );
    expect(r.verificationStatus).not.toBe("confirmed_business");
    expect(r.verifiedCountAsBusiness).toBe(false);
  });

  it("caps probable specific candidates at needs_review", () => {
    const r = verifyEntityMention(
      mention({ displayName: "가르시아 팩토리", specificity: "probable", countAsConfirmedBusiness: false }),
    );
    expect(r.verificationStatus).toBe("needs_review");
    expect(r.verifiedCountAsBusiness).toBe(false);
  });

  it("respects original non-business kinds", () => {
    for (const kind of ["advice", "platform", "generic_category", "brand_network"]) {
      const r = verifyEntityMention(
        mention({ displayName: "가르시아 팩토리", entityKind: kind, specificity: "confirmed" }),
      );
      expect(r.verifiedCountAsBusiness, kind).toBe(false);
      expect(r.verifiedEntityKind, kind).toBe(kind);
    }
  });
});

describe("entity verification mapping helpers", () => {
  const mentions = [
    mention({ mentionId: "m1", displayName: "답모터스" }),
    mention({ mentionId: "m2", displayName: "우선 고려할 곳" }),
  ];

  it("is idempotent for already verified mentions", () => {
    const first = buildEntityVerificationRows({
      orgId: "o1",
      businessId: "b1",
      mentions,
      existingMentionIds: new Set(),
    });
    expect(first.rows).toHaveLength(2);
    expect(first.skippedCount).toBe(0);
    expect(first.rows[0]!.verifier_version).toBe(ENTITY_VERIFIER_VERSION);

    const second = buildEntityVerificationRows({
      orgId: "o1",
      businessId: "b1",
      mentions,
      existingMentionIds: new Set(["m1", "m2"]),
    });
    expect(second.rows).toHaveLength(0);
    expect(second.skippedCount).toBe(2);
  });

  it("summarizes safely", () => {
    const { rows, skippedCount } = buildEntityVerificationRows({
      orgId: "o1",
      businessId: "b1",
      mentions,
      existingMentionIds: new Set(),
    });
    const summary = summarizeEntityVerificationRows({
      mentionCount: mentions.length,
      insertedRows: rows,
      skippedCount,
    });
    expect(summary.confirmedBusinessCount).toBe(1);
    expect(summary.rejectedCount).toBe(1);
    expect(summary.insertedCount).toBe(2);
  });

  it("gates the UI on the current verifier version", () => {
    expect(
      isVerifiedBusinessMention({
        verifier_version: ENTITY_VERIFIER_VERSION,
        verification_status: "confirmed_business",
        verified_count_as_business: true,
      }),
    ).toBe(true);
    expect(
      isVerifiedBusinessMention({
        verifier_version: "0.0.9",
        verification_status: "confirmed_business",
        verified_count_as_business: true,
      }),
    ).toBe(false);
    expect(isVerifiedBusinessMention(null)).toBe(false);
  });
});
