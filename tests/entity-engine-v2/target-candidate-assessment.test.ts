import { describe, expect, it } from "vitest";
import {
  assessTargetCandidateV2,
  TARGET_CANDIDATE_ASSESSMENT_VERSION,
} from "../../supabase/functions/_shared/entity-engine-v2/target-candidate-assessment";

const TARGET = {
  businessId: "11111111-1111-4111-8111-111111111111",
  name: "카스페이스 구로점",
  aliases: ["카스페이스구로점"],
  canonicalNaverPlaceId:
    "https://map.naver.com/p/entry/place/1069740203?placePath=%2Fhome",
  fullAddress: "서울 구로구 경인로53나길 27 1층",
  verifiedPhone: null,
  verifiedConcreteOfficialUrls: [],
  branchIdentityKey: null,
};

describe("Target Candidate Assessment v0.1", () => {
  it("marks exact current business id as candidate", () => {
    const result = assessTargetCandidateV2({
      target: TARGET,
      observed: {
        businessId: TARGET.businessId,
        name: "다른 표면형",
      },
      inputComplete: true,
    });

    expect(result.decision).toBe("candidate");
    expect(result.version).toBe(TARGET_CANDIDATE_ASSESSMENT_VERSION);
    expect(result.evidenceKinds).toContain("exact_current_business_id");
  });

  it("marks exact target alias surface as candidate without proving equivalence", () => {
    const result = assessTargetCandidateV2({
      target: TARGET,
      observed: { name: "카스페이스구로점" },
      observedSurface: "카스페이스구로점",
      inputComplete: true,
    });

    expect(result.decision).toBe("candidate");
    expect(result.evidenceKinds).toContain("exact_target_surface");
  });

  it("marks same-address public identity as candidate recall only", () => {
    const result = assessTargetCandidateV2({
      target: TARGET,
      observed: {
        name: "카스페이스 구로 본점",
        aliases: ["카스페이스 구로점"],
        fullAddress: "서울 구로구 경인로53나길 27 1층",
      },
      observedSurface: "카스페이스 구로 본점",
      inputComplete: true,
    });

    expect(result.decision).toBe("candidate");
    expect(
      result.evidenceKinds.some((kind) =>
        ["public_alias_overlap", "exact_full_address_recall"].includes(kind),
      ),
    ).toBe(true);
  });

  it("keeps a same-brand different-branch surface in candidate recall instead of false", () => {
    const result = assessTargetCandidateV2({
      target: TARGET,
      observed: {
        name: "카스페이스 강남점",
      },
      observedSurface: "카스페이스 강남점",
      inputComplete: true,
    });

    expect(result.decision).toBe("candidate");
    expect(result.evidenceKinds).toContain("surface_recall_relation");
  });

  it("marks an unrelated competitor surface as not_candidate", () => {
    const result = assessTargetCandidateV2({
      target: TARGET,
      observed: {
        name: "레이노 개봉점",
      },
      observedSurface: "레이노 개봉점",
      inputComplete: true,
    });

    expect(result.decision).toBe("not_candidate");
    expect(result.evidenceKinds).toContain("surface_recall_negative");
  });

  it("uses a conflicting Naver Place id as strong negative candidate evidence", () => {
    const result = assessTargetCandidateV2({
      target: TARGET,
      observed: {
        name: "카스페이스 다른 지점",
        canonicalNaverPlaceId:
          "https://map.naver.com/p/entry/place/9999999999",
      },
      observedSurface: "카스페이스 다른 지점",
      inputComplete: true,
    });

    expect(result.decision).toBe("not_candidate");
    expect(result.evidenceKinds).toContain("canonical_naver_place_conflict");
  });

  it("returns unknown instead of confident false when required input is incomplete", () => {
    const result = assessTargetCandidateV2({
      target: TARGET,
      observed: {
        name: "레이노 개봉점",
      },
      observedSurface: "레이노 개봉점",
      inputComplete: false,
    });

    expect(result.decision).toBe("unknown");
    expect(result.inputComplete).toBe(false);
  });

  it("is deterministic across alias ordering", () => {
    const first = assessTargetCandidateV2({
      target: {
        ...TARGET,
        aliases: ["카스페이스구로점", "카스페이스 구로점"],
      },
      observed: {
        name: "카스페이스 구로 본점",
        aliases: ["카스페이스 구로점", "카스페이스구로점"],
      },
      observedSurface: "카스페이스 구로 본점",
      inputComplete: true,
    });
    const second = assessTargetCandidateV2({
      target: {
        ...TARGET,
        aliases: ["카스페이스 구로점", "카스페이스구로점"],
      },
      observed: {
        name: "카스페이스 구로 본점",
        aliases: ["카스페이스구로점", "카스페이스 구로점"],
      },
      observedSurface: "카스페이스 구로 본점",
      inputComplete: true,
    });

    expect(second).toEqual(first);
  });
});
