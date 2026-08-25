import { describe, expect, it } from "vitest";
import { buildPinnedLiveQuestions, type LiveQuestionRow } from "./experiments.followup.helpers";
import type { SnapshotQuestion } from "./experiments.helpers";

const q = (id: string, active = true): SnapshotQuestion => ({
  id,
  prompt_text: `prompt ${id}`,
  prompt_hash: `hash-${id}`,
  intent_type: "visibility_gap",
  language: "ko",
  country_code: "KR",
  region: null,
  city: null,
  weight: 1,
  data_class: "public",
  active,
});

const row = (id: string, active = true): LiveQuestionRow => ({
  id,
  prompt_text: `prompt ${id}`,
  prompt_hash: `hash-${id}`,
  intent_type: "visibility_gap",
  language: "ko",
  country_code: "KR",
  region: null,
  city: null,
  weight: 1,
  data_class: "public",
  active,
});

describe("buildPinnedLiveQuestions", () => {
  it("pinned 3개와 extra active 2개가 있어도 pinned 질문만 반환한다", () => {
    const result = buildPinnedLiveQuestions(
      [q("q1"), q("q2"), q("q3")],
      [row("q1"), row("q2"), row("q3"), row("q4"), row("q5")],
    );
    expect(result).toEqual({ ok: true, questions: [q("q1"), q("q2"), q("q3")] });
  });

  it("pinned 질문 하나가 비활성/누락이면 condition drift로 fail closed 한다", () => {
    expect(buildPinnedLiveQuestions([q("q1"), q("q2"), q("q3")], [row("q1"), row("q2")])).toEqual({
      ok: false,
      error: "FOLLOWUP_CONDITION_DRIFT",
    });
    expect(buildPinnedLiveQuestions([q("q1"), q("q2"), q("q3")], [row("q1"), row("q2"), row("q3", false)])).toEqual({
      ok: false,
      error: "FOLLOWUP_CONDITION_DRIFT",
    });
  });
});