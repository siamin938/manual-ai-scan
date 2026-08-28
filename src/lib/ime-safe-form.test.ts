import { describe, expect, it } from "vitest";
import { isImeComposingEvent, mergeFieldSnapshot, readTextFieldSnapshot } from "./ime-safe-form";

describe("isImeComposingEvent", () => {
  it("nativeEvent.isComposing이 true면 조합 중으로 판단한다", () => {
    expect(isImeComposingEvent({ nativeEvent: { isComposing: true } })).toBe(true);
  });

  it("legacy keyCode 229도 조합 중으로 판단한다", () => {
    expect(isImeComposingEvent({ nativeEvent: { keyCode: 229 } })).toBe(true);
    expect(isImeComposingEvent({ keyCode: 229 })).toBe(true);
  });

  it("일반 Enter는 조합 중이 아니다", () => {
    expect(isImeComposingEvent({ keyCode: 13, nativeEvent: { isComposing: false } })).toBe(false);
    expect(isImeComposingEvent(null)).toBe(false);
  });
});

describe("readTextFieldSnapshot", () => {
  const form = {
    elements: [
      { name: "name", value: "강남 모터스", type: "text" },
      { name: "city", value: "성남", type: "text" },
      { name: "active", value: "on", type: "checkbox" },
      { name: "ignored", value: "x", type: "text" },
    ],
  };

  it("요청한 텍스트 필드의 DOM 값만 읽는다", () => {
    expect(readTextFieldSnapshot(form, ["name", "city"])).toEqual({
      name: "강남 모터스",
      city: "성남",
    });
  });

  it("checkbox/radio와 없는 필드는 제외한다", () => {
    expect(readTextFieldSnapshot(form, ["active", "missing"])).toEqual({});
  });

  it("폼이 없으면 빈 snapshot을 반환한다", () => {
    expect(readTextFieldSnapshot(null, ["name"])).toEqual({});
  });
});

describe("mergeFieldSnapshot", () => {
  it("snapshot에 있는 키만 덮어쓴다", () => {
    const current = { name: "강남", city: "성남", active: true };
    expect(mergeFieldSnapshot(current, { name: "강남 모터스" })).toEqual({
      name: "강남 모터스",
      city: "성남",
      active: true,
    });
  });
});
