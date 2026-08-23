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

describe("entity verifier v0.1.1 production regression fixtures", () => {
  const NON_BUSINESS_FIXTURES = [
    "휠·타이어·서스펜션",
    "같은 **르노 차종의 최근 작업 사례**가 있는지",
    "같은 차종·같은 연식 작업 사진**이 있는지",
    "같은 차종의 실제 시공 사진**이 있는지",
    "견적서에 부품비와 공임이 구분되어 있는지",
    "구조변경·등화류·소음 관련 합법성",
    "동일 르노 차종 작업 사례가 있는 전문점 2~3곳에 견적 비교",
    "르노 차종 작업 사진 또는 실제 작업 차량이 있는가",
    "르노코리아 공식 정비사업소",
    "배선 절단 없이 작업 가능한가요",
    "범퍼·엠블럼·배선 작업 후 **경고등이나 누수 문제가 없는지",
    "부품 브랜드·공임·A/S·구조변경 비용을 견적서에 명시",
    "부품 장착 후 차량 진단 및 오류코드 확인이 가능한가",
    "부품 제조사·품질보증·재작업 조건을 서면으로 주는지",
    "브레이크·서스펜션 점검 및 교체",
    "서스펜션 및 차고 조절",
    "서스펜션·브레이크·휠 튜닝",
    "서스펜션·쇼바·튜닝쇼바 전문점입니다",
    "서스펜션·차고 조절",
    "순정 전자제어 서스펜션 또는 주행보조 시스템 영향",
    "신차패키지, 엠비언트, 랩핑, PPF, 블랙박스 등 전장·드레스업 계열을 다루는 멀티샵입니다",
    "업체에 전화할 때 물어볼 질문",
    "인테리어·엠비언트 위주라면 별도 전문점",
    "작업 전후 **고장코드 및 진단기 스캔**을 해주는지",
    "작업 후 잡소리·도장·단차에 대한 보증 기간",
    "정비 문제가 함께 있는 경우",
    "정확한 **차종·연식·트림",
    "진접정비에서 현재 차량 상태와 보증 영향 확인",
    "차량 보증 및 전장 고장 발생 시 A/S 범위",
    "카오디오·방음:** 카오디오 전문점 위주로 비교 견적",
    "튜닝 종류별 추천 지역",
    "하이브리드 차량은 고전압 배터리·구동계에 영향을 주지 않는지",
    "휠·타이어·서스펜션:",
    "XM3·아르카나 엠비언트/랩핑/전장** → 티티오토스 계열 멀티샵",
    "구리·하남·의정부의 수입차/고성능 튜닝 전문점",
    "남양주·구리·하남권 배기/용접 전문 튜닝샵",
    "브레이크·서스펜션·경고등·전자장비:** 진접정비센터를 1차로 추천",
    "성격:** 르노코리아 공식 서비스 네트워크 계열 정비소",
  ];

  it("rejects all non-business fixtures", () => {
    expect(NON_BUSINESS_FIXTURES).toHaveLength(38);
    for (const name of NON_BUSINESS_FIXTURES) {
      const r = verifyEntityMention(mention({ displayName: name }));
      expect(r.verificationStatus, name).toBe("rejected_non_business");
      expect(r.verifiedCountAsBusiness, name).toBe(false);
      expect(["generic_category", "advice", "brand_network"], name).toContain(r.verifiedEntityKind);
    }
  });

  it("keeps uncertain name-like candidates at needs_review", () => {
    const names = ["쇼바팩토리", "튜닝925", "튜닝925 평택점", "티티오토스", "남양주 진엘이디"];
    for (const name of names) {
      const r = verifyEntityMention(
        mention({
          displayName: name,
          entityKind: "ambiguous",
          specificity: "probable",
          countAsConfirmedBusiness: false,
        }),
      );
      expect(r.verificationStatus, name).toBe("needs_review");
      expect(r.verifiedCountAsBusiness, name).toBe(false);
    }
  });

  it("does not treat 튜닝 or 전문점 as intrinsic business identity", () => {
    for (const name of ["튜닝", "수입차 전문점", "고성능 튜닝"]) {
      const r = verifyEntityMention(mention({ displayName: name }));
      expect(r.verificationStatus, name).not.toBe("confirmed_business");
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
