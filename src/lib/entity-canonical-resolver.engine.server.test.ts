import { describe, expect, it } from "vitest";
import {
  canonicalNamesRelated,
  crossScriptParentheticalBase,
  normalizeConcreteSourceUrl,
  shouldMergeCanonicalCandidates,
} from "./entity-canonical-resolver.engine.server";

describe("crossScriptParentheticalBase", () => {
  it("한글명 + 영문 괄호 별칭을 안전한 base로 인식한다", () => {
    expect(crossScriptParentheticalBase("제이존(J Zone)")).toBe("제이존");
    expect(crossScriptParentheticalBase("카핏 (Carfit)")).toBe("카핏");
  });

  it("같은 문자 체계의 지점 괄호는 alias로 승격하지 않는다", () => {
    expect(crossScriptParentheticalBase("레이노(구로점)")).toBeNull();
    expect(crossScriptParentheticalBase("더플레이스카(본점)")).toBeNull();
  });

  it("한글/영문이 섞인 outer name은 보수적으로 제외한다", () => {
    expect(crossScriptParentheticalBase("ABC모터스(서울점)")).toBeNull();
  });
});

describe("canonicalNamesRelated", () => {
  it("제이존과 제이존(J Zone)을 같은 이름 관계로 본다", () => {
    expect(canonicalNamesRelated("제이존", "제이존(J Zone)")).toBe(true);
  });

  it("레이노와 레이노(구로점)은 새 괄호 alias 규칙만으로 합치지 않는다", () => {
    expect(canonicalNamesRelated("레이노", "레이노(구로점)")).toBe(false);
  });
});

describe("normalizeConcreteSourceUrl", () => {
  it("tracking parameter를 제거해 같은 실제 페이지로 정규화한다", () => {
    expect(normalizeConcreteSourceUrl("https://pf.kakao.com/_Lxaxiixj?utm_source=openai"))
      .toBe("pf.kakao.com/_Lxaxiixj");
    expect(normalizeConcreteSourceUrl("https://pf.kakao.com/_Lxaxiixj"))
      .toBe("pf.kakao.com/_Lxaxiixj");
  });

  it("도메인 루트만 있는 URL은 concrete evidence로 사용하지 않는다", () => {
    expect(normalizeConcreteSourceUrl("https://example.com/"))
      .toBeNull();
  });
});

describe("shouldMergeCanonicalCandidates", () => {
  it("cross-script 별칭 + 동일 concrete URL이면 병합한다", () => {
    expect(shouldMergeCanonicalCandidates({
      leftName: "제이존",
      rightName: "제이존(J Zone)",
      leftSourceUrls: ["https://pf.kakao.com/_Lxaxiixj?utm_source=openai"],
      rightSourceUrls: ["https://pf.kakao.com/_Lxaxiixj"],
    })).toBe(true);
  });

  it("이름이 같아 보여도 동일 concrete URL이 없으면 병합하지 않는다", () => {
    expect(shouldMergeCanonicalCandidates({
      leftName: "제이존",
      rightName: "제이존(J Zone)",
      leftSourceUrls: ["https://example.com/a"],
      rightSourceUrls: ["https://example.com/b"],
    })).toBe(false);
  });

  it("지점 괄호는 동일 URL이어도 자동 병합하지 않는다", () => {
    expect(shouldMergeCanonicalCandidates({
      leftName: "레이노",
      rightName: "레이노(구로점)",
      leftSourceUrls: ["https://example.com/dealer/1"],
      rightSourceUrls: ["https://example.com/dealer/1"],
    })).toBe(false);
  });
});
