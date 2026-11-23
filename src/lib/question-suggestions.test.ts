import { describe, expect, it } from "vitest";
import {
  buildInsertPayloads,
  containsTargetBusinessName,
  dedupeForSave,
  mapSuggestError,
  normalizeQuestion,
  resolveQuestionLocation,
  toCandidates,
  type SuggestionCandidate,
} from "./question-suggestions";

const cand = (p: Partial<SuggestionCandidate>): SuggestionCandidate => ({
  id: "x",
  promptText: "판교 근처 추천할 만한 정비소는 어디인가요?",
  intentType: "recommendation",
  selected: true,
  containsBusinessName: false,
  ...p,
});

describe("normalizeQuestion", () => {
  it("공백/문장부호/대소문자를 제거한다", () => {
    expect(normalizeQuestion(" Hello,  World? ")).toBe("helloworld");
  });
});

describe("containsTargetBusinessName", () => {
  it("공백 변형이 있어도 탐지", () => {
    expect(containsTargetBusinessName("현대 엑스티어 판교 어때요?", "현대엑스티어판교")).toBe(true);
    expect(containsTargetBusinessName("현대엑스티어  판교는?", "현대 엑스티어 판교")).toBe(true);
  });
  it("포함되지 않으면 false", () => {
    expect(containsTargetBusinessName("판교 정비소 추천", "현대엑스티어판교")).toBe(false);
  });
  it("빈 업체명은 false", () => {
    expect(containsTargetBusinessName("아무 질문", "")).toBe(false);
  });
});

describe("toCandidates", () => {
  it("길이/intent 위반 항목을 제외한다", () => {
    const out = toCandidates(
      [
        { prompt_text: "짧음", intent_type: "local" },
        { prompt_text: "판교 정비소 추천해 주세요", intent_type: "unknown_intent" },
        { prompt_text: "판교 정비소 추천해 주세요", intent_type: "recommendation" },
        { prompt_text: "판교  정비소 추천해 주세요", intent_type: "local" },
        { prompt_text: "a".repeat(300), intent_type: "local" },
      ],
      "현대엑스티어판교",
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.intentType).toBe("recommendation");
  });

  it("업체명이 포함되면 기본 선택 해제 + 경고", () => {
    const out = toCandidates(
      [{ prompt_text: "현대 엑스티어 판교 후기 어떤가요?", intent_type: "review_quality" }],
      "현대엑스티어판교",
    );
    expect(out[0]!.selected).toBe(false);
    expect(out[0]!.containsBusinessName).toBe(true);
  });

  it("배열이 아니면 빈 목록", () => {
    expect(toCandidates(null, "업체")).toEqual([]);
  });
});

describe("dedupeForSave", () => {
  it("기존 질문 및 후보 간 exact duplicate를 skip", () => {
    const res = dedupeForSave(
      [
        cand({ id: "1", promptText: "판교 정비소 추천해 주세요" }),
        cand({ id: "2", promptText: "판교  정비소 추천해 주세요 " }),
        cand({ id: "3", promptText: "판교 도장 잘하는 곳 있나요?" }),
      ],
      ["판교 정비소 추천해 주세요"],
    );
    expect(res.kept.map((c) => c.id)).toEqual(["3"]);
    expect(res.skipped).toBe(2);
  });

  it("길이/intent 위반도 skip", () => {
    const res = dedupeForSave(
      [
        cand({ id: "1", promptText: "짧음" }),
        cand({ id: "2", intentType: "bad" as never }),
      ],
      [],
    );
    expect(res.kept).toHaveLength(0);
    expect(res.skipped).toBe(2);
  });
});

describe("resolveQuestionLocation", () => {
  it("서울 범위 질문이면 숨은 구로구 city를 제거한다", () => {
    expect(resolveQuestionLocation("서울 썬팅 업체 어디야?", "서울특별시", "구로구")).toEqual({
      region: "서울특별시",
      city: null,
    });
  });

  it("구로구 범위 질문이면 구로구 city를 유지한다", () => {
    expect(resolveQuestionLocation("구로구 썬팅 전문점 어디가 있어?", "서울특별시", "구로구")).toEqual({
      region: "서울특별시",
      city: "구로구",
    });
  });

  it("고양시 일산동구에서 고양 범위와 일산동구 범위를 구분한다", () => {
    expect(resolveQuestionLocation("고양 썬팅 업체 어디가 있어?", "경기도", "고양시 일산동구")).toEqual({
      region: "경기도",
      city: "고양시",
    });
    expect(resolveQuestionLocation("일산동구 썬팅 업체 추천해줘", "경기도", "고양시 일산동구")).toEqual({
      region: "경기도",
      city: "고양시 일산동구",
    });
  });

  it("경기도 Core 질문은 성남시 분당구 상세 city를 제거한다", () => {
    expect(
      resolveQuestionLocation(
        "경기에서 프리미엄 엔진오일 잘하는 업체 추천해줘",
        "경기도",
        "성남시 분당구",
      ),
    ).toEqual({
      region: "경기도",
      city: null,
    });

    expect(
      resolveQuestionLocation(
        "성남 분당에서 프리미엄 엔진오일 맡길 만한 업체 추천해줘",
        "경기도",
        "성남시 분당구",
      ),
    ).toEqual({
      region: "경기도",
      city: "성남시 분당구",
    });
  });

  it("단일 시 단위는 기존 city를 유지한다", () => {
    expect(resolveQuestionLocation("파주 타이어 업체 어디야?", "경기도", "파주시")).toEqual({
      region: "경기도",
      city: "파주시",
    });
  });

  it("질문에서 지역 범위를 판별할 수 없으면 기존 메타데이터를 보존한다", () => {
    expect(resolveQuestionLocation("썬팅 시공 후기 좋은 업체 알려줘", "서울특별시", "구로구")).toEqual({
      region: "서울특별시",
      city: "구로구",
    });
  });
});

describe("buildInsertPayloads", () => {
  it("고정 필드를 항상 강제한다", () => {
    const [p] = buildInsertPayloads([cand({})], {
      orgId: "org1",
      questionSetId: "set1",
      region: "경기",
      city: null,
    });
    expect(p).toMatchObject({
      org_id: "org1",
      question_set_id: "set1",
      language: "ko",
      country_code: "KR",
      weight: 1,
      data_class: "public",
      active: true,
      region: "경기",
      city: null,
    });
  });

  it("최종 질문 문구에 맞춰 서울/구로구 location metadata를 저장한다", () => {
    const [seoul, guro] = buildInsertPayloads(
      [
        cand({ id: "1", promptText: "서울 썬팅 업체 어디야?", intentType: "local" }),
        cand({ id: "2", promptText: "구로구 썬팅 업체 어디야?", intentType: "local" }),
      ],
      {
        orgId: "org1",
        questionSetId: "set1",
        region: "서울특별시",
        city: "구로구",
      },
    );
    expect(seoul).toMatchObject({ region: "서울특별시", city: null });
    expect(guro).toMatchObject({ region: "서울특별시", city: "구로구" });
  });
});

describe("mapSuggestError", () => {
  it("raw 에러를 안전 문구로 매핑", () => {
    expect(mapSuggestError("SERVER_NOT_CONFIGURED")).toContain("관리자");
    expect(mapSuggestError("AI_OUTPUT_INVALID")).toContain("생성");
    expect(mapSuggestError("Unauthorized")).toContain("권한");
    expect(mapSuggestError("PUBLIC_EVIDENCE_NOT_FOUND")).toContain("공개 웹");
    expect(mapSuggestError("PUBLIC_EVIDENCE_CHECK_FAILED")).toContain("공개 정보");
    expect(mapSuggestError("boom")).toContain("오류");
  });
});
