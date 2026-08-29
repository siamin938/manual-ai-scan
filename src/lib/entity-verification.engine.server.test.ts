import { describe, expect, it } from "vitest";
import {
  buildEntityVerificationRows,
  buildParserConfirmedNameKeys,
  buildProbableRepeatCounts,
  buildRepeatCounts,
  verifyEntityMention,
  type EntityVerificationInput,
} from "./entity-verification.engine.server";

function mention(over: Partial<EntityVerificationInput> = {}): EntityVerificationInput {
  return {
    mentionId: over.mentionId ?? "m1",
    measurementId: over.measurementId ?? "meas1",
    matchedBusinessId: over.matchedBusinessId ?? null,
    displayName: over.displayName ?? "테스트",
    entityKind: over.entityKind ?? "specific_business",
    specificity: over.specificity ?? "probable",
    countAsConfirmedBusiness: over.countAsConfirmedBusiness ?? false,
    resolutionConfidence: over.resolutionConfidence ?? "medium",
  };
}

describe("entity verification v0.1.4", () => {
  it("v0.1.4-a) ambiguous+probable repeated across 2 measurements => confirmed", () => {
    const mentions = [
      mention({ mentionId: "a", measurementId: "m1", displayName: "일산하이테크", entityKind: "ambiguous", specificity: "probable" }),
      mention({ mentionId: "b", measurementId: "m2", displayName: "일산하이테크", entityKind: "ambiguous", specificity: "probable" }),
    ];
    const probable = buildProbableRepeatCounts(mentions);
    const r = verifyEntityMention(mentions[0]!, {
      repeatCount: buildRepeatCounts(mentions).get("일산하이테크") ?? 1,
      probableRepeatCount: probable.get("일산하이테크") ?? 1,
    });
    expect(r.verificationStatus).toBe("confirmed_business");
    expect(r.verifiedEntityKind).toBe("specific_business");
    expect(r.verifiedCountAsBusiness).toBe(true);
    expect(r.confidence).toBe("medium");
    expect(r.reasonCodes).toContain("REPEATED_PROBABLE_ACROSS_RESPONSES");
    expect(r.reasonCodes).toContain("AMBIGUOUS_PROBABLE_REPEATED");
  });

  it("v0.1.4-b) name repeats twice but probable only once => needs_review", () => {
    const mentions = [
      mention({ mentionId: "a", measurementId: "m1", displayName: "일산하이테크", entityKind: "ambiguous", specificity: "probable" }),
      mention({ mentionId: "b", measurementId: "m2", displayName: "일산하이테크", entityKind: "ambiguous", specificity: "ambiguous" }),
    ];
    const probable = buildProbableRepeatCounts(mentions);
    expect(probable.get("일산하이테크")).toBe(1);
    const r = verifyEntityMention(mentions[0]!, {
      repeatCount: buildRepeatCounts(mentions).get("일산하이테크") ?? 1,
      probableRepeatCount: probable.get("일산하이테크") ?? 1,
    });
    expect(r.verificationStatus).toBe("needs_review");
  });

  it("v0.1.4-c) ambiguous+ambiguous repeated => needs_review", () => {
    const mentions = [
      mention({ mentionId: "a", measurementId: "m1", displayName: "PPF 부위", entityKind: "ambiguous", specificity: "ambiguous" }),
      mention({ mentionId: "b", measurementId: "m2", displayName: "PPF 부위", entityKind: "ambiguous", specificity: "ambiguous" }),
    ];
    const r = verifyEntityMention(mentions[0]!, {
      repeatCount: 2,
      probableRepeatCount: buildProbableRepeatCounts(mentions).get("ppf부위") ?? 1,
    });
    expect(r.verificationStatus).toBe("needs_review");
  });

  it("1) medium specific_business + BRANCH_MARKER => confirmed", () => {
    const r = verifyEntityMention(mention({ displayName: "블루핸즈 서현지점" }));
    expect(r.verificationStatus).toBe("confirmed_business");
    expect(r.verifiedEntityKind).toBe("specific_business");
    expect(r.reasonCodes).toContain("BRANCH_MARKER");
  });

  it("2) medium + STRONG_BUSINESS_DESCRIPTOR => confirmed", () => {
    const r = verifyEntityMention(mention({ displayName: "오일튠 카센터" }));
    expect(r.verificationStatus).toBe("confirmed_business");
    expect(r.reasonCodes).toContain("STRONG_BUSINESS_DESCRIPTOR");
    expect(r.verifiedCountAsBusiness).toBe(true);
  });

  it("3) medium + PROBABLE_ONLY + repeated across 2 responses => confirmed", () => {
    const r = verifyEntityMention(mention({ displayName: "세종하이테크" }), { repeatCount: 2 });
    expect(r.verificationStatus).toBe("confirmed_business");
    expect(r.reasonCodes).toContain("REPEATED_ACROSS_RESPONSES");
  });

  it("4) same candidate seen only once => needs_review", () => {
    const r = verifyEntityMention(mention({ displayName: "세종하이테크" }), { repeatCount: 1 });
    expect(r.verificationStatus).toBe("needs_review");
    expect(r.reasonCodes).toContain("PROBABLE_ONLY");
  });

  it("5) low confidence (non specific_business kind) repeated 3 times => needs_review", () => {
    const r = verifyEntityMention(
      mention({ displayName: "세종하이테크", entityKind: "ambiguous" }),
      { repeatCount: 3 },
    );
    expect(r.verificationStatus).toBe("needs_review");
    expect(r.confidence).toBe("low");
  });

  it("6) ambiguous/generic/service/list kinds are never confirmed by repetition", () => {
    for (const kind of ["generic_category", "platform", "advice", "brand_network"]) {
      const r = verifyEntityMention(mention({ displayName: "엔진오일 전문점", entityKind: kind }), {
        repeatCount: 5,
      });
      expect(r.verificationStatus).toBe("rejected_non_business");
    }
    const ambiguous = verifyEntityMention(
      mention({ displayName: "센터", entityKind: "ambiguous" }),
      { repeatCount: 5 },
    );
    expect(ambiguous.verificationStatus).not.toBe("confirmed_business");
  });

  it("6b) ambiguous + BRANCH_MARKER + repeated across 2 responses => confirmed", () => {
    const r = verifyEntityMention(
      mention({ displayName: "루마썬팅 일산고일로점", entityKind: "ambiguous" }),
      { repeatCount: 2 },
    );
    expect(r.verificationStatus).toBe("confirmed_business");
    expect(r.verifiedEntityKind).toBe("specific_business");
    expect(r.verifiedCountAsBusiness).toBe(true);
    expect(r.confidence).toBe("medium");
    expect(r.reasonCodes).toContain("BRANCH_MARKER");
    expect(r.reasonCodes).toContain("REPEATED_ACROSS_RESPONSES");
    expect(r.reasonCodes).toContain("AMBIGUOUS_BRANCH_REPEATED");
  });

  it("6c) ambiguous + BRANCH_MARKER seen only once => needs_review", () => {
    const r = verifyEntityMention(
      mention({ displayName: "루마썬팅 일산고일로점", entityKind: "ambiguous" }),
      { repeatCount: 1 },
    );
    expect(r.verificationStatus).toBe("needs_review");
    expect(r.reasonCodes).not.toContain("AMBIGUOUS_BRANCH_REPEATED");
  });

  it("6d) ambiguous + descriptor + repeated => needs_review (new rule does not apply)", () => {
    const r = verifyEntityMention(
      mention({ displayName: "비랩팩토리", entityKind: "ambiguous" }),
      { repeatCount: 3 },
    );
    expect(r.verificationStatus).toBe("needs_review");
  });

  it("6e) ambiguous + repeated only => needs_review", () => {
    const r = verifyEntityMention(
      mention({ displayName: "세종하이테크", entityKind: "ambiguous" }),
      { repeatCount: 3 },
    );
    expect(r.verificationStatus).toBe("needs_review");
  });

  it("7) registered business match with confirmed parser output stays high confirmed", () => {
    const r = verifyEntityMention(
      mention({
        displayName: "현대엑스티어 판교",
        matchedBusinessId: "b1",
        specificity: "confirmed",
        countAsConfirmedBusiness: true,
      }),
    );
    expect(r.verificationStatus).toBe("confirmed_business");
    expect(r.confidence).toBe("high");
    expect(r.reasonCodes).toEqual(["REGISTERED_BUSINESS_MATCH"]);
  });

  it("8) sentence-like and checklist-like candidates stay rejected", () => {
    expect(
      verifyEntityMention(mention({ displayName: "어디가 제일 저렴한가요?" })).verificationStatus,
    ).toBe("rejected_non_business");
    expect(
      verifyEntityMention(mention({ displayName: "엔진오일·필터·공임 비교" })).verificationStatus,
    ).toBe("rejected_non_business");
    expect(
      verifyEntityMention(mention({ displayName: "업체 선택 기준" })).verificationStatus,
    ).toBe("rejected_non_business");
    expect(
      verifyEntityMention(mention({ displayName: "가까운 곳 2~3곳" })).verificationStatus,
    ).toBe("rejected_non_business");
  });

  it("counts repetition by distinct measurement, not by mention row", () => {
    const counts = buildRepeatCounts([
      mention({ mentionId: "a", measurementId: "m1", displayName: "세종 하이테크" }),
      mention({ mentionId: "b", measurementId: "m1", displayName: "세종하이테크" }),
      mention({ mentionId: "c", measurementId: "m2", displayName: "세종하이테크" }),
    ]);
    expect(counts.get("세종하이테크")).toBe(2);
  });

  it("builds rows at version 0.1.5 and skips already-verified mentions", () => {
    const mentions = [
      mention({ mentionId: "a", measurementId: "m1", displayName: "세종하이테크" }),
      mention({ mentionId: "b", measurementId: "m2", displayName: "세종하이테크" }),
    ];
    const { rows, skippedCount } = buildEntityVerificationRows({
      orgId: "o1",
      businessId: "b1",
      mentions,
      existingMentionIds: new Set(["a"]),
      repeatCounts: buildRepeatCounts(mentions),
    });
    expect(skippedCount).toBe(1);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.verifier_version).toBe("0.1.5");
    expect(rows[0]!.verification_status).toBe("confirmed_business");
  });
});

describe("entity verification v0.1.5", () => {
  it("v0.1.5-a) parser-confirmed exact name in scope promotes ambiguous sibling", () => {
    const mentions = [
      mention({
        mentionId: "a",
        measurementId: "m1",
        displayName: "한빛모터스 일산",
        entityKind: "specific_business",
        specificity: "confirmed",
        countAsConfirmedBusiness: true,
      }),
      mention({
        mentionId: "b",
        measurementId: "m2",
        displayName: "한빛모터스 일산",
        entityKind: "ambiguous",
        specificity: "ambiguous",
      }),
    ];
    const keys = buildParserConfirmedNameKeys(mentions);
    expect(keys.has("한빛모터스일산")).toBe(true);
    const r = verifyEntityMention(mentions[1]!, {
      repeatCount: buildRepeatCounts(mentions).get("한빛모터스일산") ?? 1,
      hasParserConfirmedExactName: keys.has("한빛모터스일산"),
    });
    expect(r.verificationStatus).toBe("confirmed_business");
    expect(r.verifiedEntityKind).toBe("specific_business");
    expect(r.verifiedCountAsBusiness).toBe(true);
    expect(r.confidence).toBe("medium");
    expect(r.reasonCodes).toContain("PARSER_CONFIRMED_EXACT_NAME_IN_SCOPE");
  });

  it("v0.1.5-b) similar but not exact name is not promoted", () => {
    const mentions = [
      mention({
        mentionId: "a",
        measurementId: "m1",
        displayName: "J.ONE 제이원 썬팅자동차",
        entityKind: "specific_business",
        specificity: "confirmed",
        countAsConfirmedBusiness: true,
      }),
    ];
    const keys = buildParserConfirmedNameKeys(mentions);
    const r = verifyEntityMention(
      mention({
        mentionId: "b",
        measurementId: "m2",
        displayName: "J.ONE 제이원",
        entityKind: "ambiguous",
        specificity: "ambiguous",
      }),
      { hasParserConfirmedExactName: keys.has("j.one제이원") },
    );
    expect(keys.has("j.one제이원")).toBe(false);
    expect(r.verificationStatus).toBe("needs_review");
  });

  it("v0.1.5-c) parser-confirmed key exists but current kind is generic_category => still rejected", () => {
    const mentions = [
      mention({
        mentionId: "a",
        measurementId: "m1",
        displayName: "동네 카센터 추천",
        entityKind: "specific_business",
        specificity: "confirmed",
        countAsConfirmedBusiness: true,
      }),
    ];
    const keys = buildParserConfirmedNameKeys(mentions);
    const r = verifyEntityMention(
      mention({
        mentionId: "b",
        measurementId: "m2",
        displayName: "동네 카센터 추천",
        entityKind: "generic_category",
        specificity: "ambiguous",
      }),
      { hasParserConfirmedExactName: keys.has("동네카센터추천") },
    );
    expect(r.verificationStatus).toBe("rejected_non_business");
    expect(r.verifiedEntityKind).toBe("generic_category");
  });

  it("v0.1.5-d) buildEntityVerificationRows wires parserConfirmedNameKeys through", () => {
    const mentions = [
      mention({
        mentionId: "a",
        measurementId: "m1",
        displayName: "한빛모터스 일산",
        entityKind: "specific_business",
        specificity: "confirmed",
        countAsConfirmedBusiness: true,
      }),
      mention({
        mentionId: "b",
        measurementId: "m2",
        displayName: "한빛모터스 일산",
        entityKind: "ambiguous",
        specificity: "ambiguous",
      }),
    ];
    const { rows } = buildEntityVerificationRows({
      orgId: "o1",
      businessId: "b1",
      mentions,
      existingMentionIds: new Set(),
      repeatCounts: buildRepeatCounts(mentions),
      probableRepeatCounts: buildProbableRepeatCounts(mentions),
      parserConfirmedNameKeys: buildParserConfirmedNameKeys(mentions),
    });
    expect(rows).toHaveLength(2);
    const ambiguousRow = rows.find((r) => r.measurement_mention_id === "b")!;
    expect(ambiguousRow.verification_status).toBe("confirmed_business");
    expect(ambiguousRow.verifier_version).toBe("0.1.5");
    expect(ambiguousRow.reason_codes).toContain("PARSER_CONFIRMED_EXACT_NAME_IN_SCOPE");
  });

  it("v0.1.5-e) ambiguous without parser-confirmed sibling stays needs_review", () => {
    const mentions = [
      mention({
        mentionId: "a",
        measurementId: "m1",
        displayName: "한빛모터스 일산",
        entityKind: "ambiguous",
        specificity: "ambiguous",
      }),
    ];
    const keys = buildParserConfirmedNameKeys(mentions);
    const r = verifyEntityMention(mentions[0]!, {
      hasParserConfirmedExactName: keys.has("한빛모터스일산"),
    });
    expect(r.verificationStatus).toBe("needs_review");
  });
});
