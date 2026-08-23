import { describe, expect, it } from "vitest";
import {
  RESOLVER_VERSION,
  compactName,
  hasStrongNameRelation,
  normalizeConcreteUrl,
  pickCanonicalDisplayName,
  resolveCanonicalEntities,
  type ResolverMentionInput,
} from "./entity-canonical-resolver";

const BIZ = "11111111-1111-1111-1111-111111111111";

function mention(
  id: string,
  measurementId: string,
  displayName: string,
  matchedBusinessId: string | null = null,
): ResolverMentionInput {
  return { mentionId: id, measurementId, displayName, matchedBusinessId, verified: true };
}

describe("normalization", () => {
  it("keeps a stable resolver version", () => {
    expect(RESOLVER_VERSION).toBe("0.1.0");
  });

  it("compacts punctuation and spacing", () => {
    expect(compactName(" 평택  코스모-모터스 ")).toBe("평택코스모모터스");
  });

  it("drops tracking params but keeps the concrete path", () => {
    expect(normalizeConcreteUrl("https://www.Example.com/shop/123?utm_source=x&id=7")).toBe(
      "example.com/shop/123?id=7",
    );
  });

  it("treats domain-only urls as non-concrete", () => {
    expect(normalizeConcreteUrl("https://example.com/")).toBeNull();
  });

  it("detects region-prefix and brand-prefix name relations", () => {
    expect(hasStrongNameRelation("코스모모터스", "평택 코스모모터스")).toBe(true);
    expect(hasStrongNameRelation("르노코리아 서비스센터 진접정비", "진접정비센터")).toBe(true);
    expect(hasStrongNameRelation("가르시아 팩토리", "답모터스")).toBe(false);
  });

  it("picks the more informative display name", () => {
    expect(pickCanonicalDisplayName(["코스모모터스", "평택 코스모모터스"])).toBe("평택 코스모모터스");
  });
});

describe("resolveCanonicalEntities", () => {
  const sharedUrls = {
    m1: ["https://blog.example.com/post/9?utm_source=naver"],
    m2: ["https://blog.example.com/post/9"],
  };

  it("merges region-prefixed duplicates sharing a concrete url", () => {
    const res = resolveCanonicalEntities({
      businessId: BIZ,
      registeredNames: {},
      mentions: [mention("a", "m1", "코스모모터스"), mention("b", "m2", "평택 코스모모터스")],
      sourceUrlsByMeasurement: sharedUrls,
    });
    expect(res).toHaveLength(2);
    expect(res[0]!.canonicalKey).toBe(res[1]!.canonicalKey);
    expect(res[0]!.resolutionStatus).toBe("merged");
    expect(res[0]!.canonicalDisplayName).toBe("평택 코스모모터스");
    expect(res[0]!.reasonCodes).toEqual(["NAME_CORE_MATCH", "SHARED_SOURCE_URL"]);
  });

  it("merges brand-service-prefixed duplicates sharing a concrete url", () => {
    const res = resolveCanonicalEntities({
      businessId: BIZ,
      registeredNames: {},
      mentions: [
        mention("a", "m1", "르노코리아 서비스센터 진접정비"),
        mention("b", "m2", "진접정비센터"),
      ],
      sourceUrlsByMeasurement: sharedUrls,
    });
    expect(res[0]!.canonicalKey).toBe(res[1]!.canonicalKey);
    expect(res[0]!.resolutionStatus).toBe("merged");
    expect(res[0]!.canonicalDisplayName).toBe("르노코리아 서비스센터 진접정비");
  });

  it("does not merge similar names without a shared url", () => {
    const res = resolveCanonicalEntities({
      businessId: BIZ,
      registeredNames: {},
      mentions: [mention("a", "m1", "코스모모터스"), mention("b", "m2", "평택 코스모모터스")],
      sourceUrlsByMeasurement: {
        m1: ["https://a.example.com/post/1"],
        m2: ["https://b.example.com/post/2"],
      },
    });
    expect(res[0]!.canonicalKey).not.toBe(res[1]!.canonicalKey);
    expect(res.every((r) => r.resolutionStatus === "standalone")).toBe(true);
  });

  it("does not merge on a shared url alone when cores differ", () => {
    const res = resolveCanonicalEntities({
      businessId: BIZ,
      registeredNames: {},
      mentions: [mention("a", "m1", "가르시아 팩토리"), mention("b", "m2", "답모터스")],
      sourceUrlsByMeasurement: sharedUrls,
    });
    expect(res[0]!.canonicalKey).not.toBe(res[1]!.canonicalKey);
    expect(res.every((r) => r.resolutionStatus === "standalone")).toBe(true);
  });

  it("does not merge on shared domain only", () => {
    const res = resolveCanonicalEntities({
      businessId: BIZ,
      registeredNames: {},
      mentions: [mention("a", "m1", "코스모모터스"), mention("b", "m2", "평택 코스모모터스")],
      sourceUrlsByMeasurement: {
        m1: ["https://blog.example.com/"],
        m2: ["https://blog.example.com/"],
      },
    });
    expect(res[0]!.canonicalKey).not.toBe(res[1]!.canonicalKey);
  });

  it("uses registered business identity for matched mentions", () => {
    const res = resolveCanonicalEntities({
      businessId: BIZ,
      registeredNames: { [BIZ]: "남양주 커스텀개러지" },
      mentions: [mention("a", "m1", "커스텀개러지", BIZ)],
      sourceUrlsByMeasurement: {},
    });
    expect(res[0]).toMatchObject({
      canonicalKey: `business:${BIZ}`,
      canonicalDisplayName: "남양주 커스텀개러지",
      resolutionStatus: "matched_business",
      confidence: "high",
    });
  });

  it("skips unverified mentions (needs_review is never promoted)", () => {
    const res = resolveCanonicalEntities({
      businessId: BIZ,
      registeredNames: {},
      mentions: [{ ...mention("a", "m1", "쇼바팩토리"), verified: false }],
      sourceUrlsByMeasurement: {},
    });
    expect(res).toHaveLength(0);
  });

  it("is deterministic for the same input", () => {
    const args = {
      businessId: BIZ,
      registeredNames: {},
      mentions: [mention("a", "m1", "코스모모터스"), mention("b", "m2", "평택 코스모모터스")],
      sourceUrlsByMeasurement: sharedUrls,
    };
    expect(resolveCanonicalEntities(args)).toEqual(resolveCanonicalEntities(args));
  });
});
