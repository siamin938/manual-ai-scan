import { describe, expect, it } from "vitest";
import {
  aggregateBusinessShare,
  isConfirmedBusinessMention,
  isObviousNonBusinessPhrase,
  type MentionFact,
} from "./mention-business-filter";

const TARGET = "11111111-1111-1111-1111-111111111111";

function m(partial: Partial<MentionFact>): MentionFact {
  return {
    measurement_id: "meas-1",
    matched_business_id: null,
    display_name: "테스트 업체",
    entity_kind: "specific_business",
    specificity: "confirmed",
    count_as_confirmed_business: true,
    ...partial,
  };
}

describe("isObviousNonBusinessPhrase", () => {
  it("filters generic headings", () => {
    expect(isObviousNonBusinessPhrase("우선 고려할 곳")).toBe(true);
    expect(isObviousNonBusinessPhrase("추천기준")).toBe(true);
    expect(isObviousNonBusinessPhrase("주의 사항")).toBe(true);
  });

  it("filters long question sentences", () => {
    expect(isObviousNonBusinessPhrase("어디를 먼저 방문하면 좋을까요")).toBe(true);
    expect(isObviousNonBusinessPhrase("판교에 정비소가 있나요?")).toBe(true);
  });

  it("keeps normal business names", () => {
    expect(isObviousNonBusinessPhrase("현대엑스티어 판교")).toBe(false);
    expect(isObviousNonBusinessPhrase("커스텀개러지")).toBe(false);
  });
});

describe("isConfirmedBusinessMention", () => {
  it("always allows the target business even without metadata", () => {
    expect(
      isConfirmedBusinessMention(
        m({ matched_business_id: TARGET, entity_kind: null, specificity: null, count_as_confirmed_business: null }),
        TARGET,
      ),
    ).toBe(true);
  });

  it("rejects unconfirmed or generic entities", () => {
    expect(isConfirmedBusinessMention(m({ specificity: "ambiguous" }), TARGET)).toBe(false);
    expect(isConfirmedBusinessMention(m({ entity_kind: "category" }), TARGET)).toBe(false);
    expect(isConfirmedBusinessMention(m({ count_as_confirmed_business: false }), TARGET)).toBe(false);
    expect(isConfirmedBusinessMention(m({ display_name: "우선 고려할 곳" }), TARGET)).toBe(false);
  });

  it("rejects everything but the target when metadata is null (pre-reparse)", () => {
    expect(
      isConfirmedBusinessMention(
        m({ entity_kind: null, specificity: null, count_as_confirmed_business: null }),
        TARGET,
      ),
    ).toBe(false);
  });

  it("does not text-filter matched DB businesses", () => {
    expect(
      isConfirmedBusinessMention(m({ matched_business_id: "biz-2", display_name: "선택 기준" }), TARGET),
    ).toBe(true);
  });
});

describe("aggregateBusinessShare", () => {
  it("dedupes response_count per measurement and computes share", () => {
    const rows = aggregateBusinessShare({
      targetBusinessId: TARGET,
      validMeasurementCount: 4,
      mentions: [
        m({ measurement_id: "a", display_name: "커스텀개러지" }),
        m({ measurement_id: "a", display_name: "커스텀개러지" }),
        m({ measurement_id: "b", display_name: "커스텀개러지" }),
        m({ measurement_id: "b", display_name: "우선 고려할 곳" }),
        m({ measurement_id: "c", matched_business_id: TARGET, display_name: "대상업체" }),
      ],
    });

    expect(rows).toHaveLength(2);
    const first = rows[0]!;
    expect(first.display_name).toBe("커스텀개러지");
    expect(first.mention_count).toBe(3);
    expect(first.response_count).toBe(2);
    expect(first.answer_share_pct).toBe(50);
    expect(rows[1]!.matched_business_id).toBe(TARGET);
    expect(rows[1]!.answer_share_pct).toBe(25);
  });

  it("returns null share when there are no valid measurements", () => {
    const rows = aggregateBusinessShare({
      targetBusinessId: null,
      validMeasurementCount: 0,
      mentions: [m({})],
    });
    expect(rows[0]!.answer_share_pct).toBeNull();
  });
});

describe("generic network phrase filter", () => {
  const NETWORK_NAMES = [
    "르노코리아 공식 서비스 네트워크",
    "공식 서비스 네트워크",
    "서비스 네트워크",
    "공식 서비스망",
    "서비스망",
    "정비 네트워크",
    "정비망",
  ];
  const REAL_NAMES = [
    "가르시아 팩토리",
    "남양주 팀카본 수입차정비센터 공임나라 협력점",
    "답모터스",
    "르노코리아 서비스센터 진접정비",
    "진접정비센터",
    "코스모모터스",
    "평택 코스모모터스",
  ];

  it("excludes generic brand service-network expressions", () => {
    for (const name of NETWORK_NAMES) {
      expect(isObviousNonBusinessPhrase(name)).toBe(true);
      expect(isConfirmedBusinessMention(m({ display_name: name }), TARGET)).toBe(false);
    }
  });

  it("keeps branch and service-center specific names", () => {
    for (const name of REAL_NAMES) {
      expect(isObviousNonBusinessPhrase(name)).toBe(false);
      expect(isConfirmedBusinessMention(m({ display_name: name }), TARGET)).toBe(true);
    }
  });

  it("keeps registered DB businesses even with network-like names", () => {
    expect(
      isConfirmedBusinessMention(
        m({ display_name: "르노코리아 공식 서비스 네트워크", matched_business_id: "b-1" }),
        TARGET,
      ),
    ).toBe(true);
  });
});
