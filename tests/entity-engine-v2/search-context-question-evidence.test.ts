import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildSearchContextQuestionEvidence,
  searchContextQuestionEvidenceLabel,
} from "../../src/lib/search-context-question-evidence";
import type {
  EntityFactsV2ReadQuestionAreaDTO,
  EntityFactsV2ReadQuestionGroupDTO,
} from "../../src/lib/entity-facts-v2-read-gateway.types";
import { INTENT_LABELS } from "../../src/lib/question-suggestions";

type Group = Pick<EntityFactsV2ReadQuestionGroupDTO,
  "intentType" | "questionCount" | "validCount" |
  "confirmedMentionCount" | "unresolvedTargetCount">;
type Area = Pick<EntityFactsV2ReadQuestionAreaDTO,
  "questionId" | "questionText" | "intentType" | "validCount" |
  "confirmedMentionCount" | "unresolvedTargetCount">;

const intentExamples = {
  local: [
    "경기에서 PPF 맡길 수 있는 곳 어디야?",
    "안산에서 PPF 맡기기 편한 업체 몇 곳 알려줘",
    "안산에서 PPF 맡길 곳을 위치와 접근성 기준으로 몇 곳 알려줘",
  ],
  recommendation: [
    "경기에서 PPF 잘하는 업체 추천해줘",
    "안산에서 PPF 맡길 만한 업체 추천해줘",
    "안산에서 PPF 업체 중 작업 경험과 후기를 함께 보고 추천해줘",
  ],
  trust: [
    "PPF 작업 경험 많은 경기 업체 어디야?",
    "안산에서 PPF 믿고 맡길 만한 곳 알려줘",
    "안산에서 PPF 작업 경험이 많은 업체 몇 곳 알려줘",
  ],
  comparison: ["경기 업체 작업 비교", "안산 업체 가격 비교", "안산 업체 후기 비교"],
  discovery: ["경기 업체 후보 알아보기", "안산 업체 후보 추천", "안산 업체 후보 추려줘"],
  price_value: ["경기 PPF 비용", "안산 가격 대비 구성", "안산 PPF 가격대"],
  review_quality: ["경기 후기", "안산 작업 만족", "안산 후기와 작업 사례"],
  service: [
    "경기에서 PPF 전문으로 하는 곳 알려줘",
    "안산에서 PPF 맡길 수 있는 업체 몇 곳 알려줘",
    "안산에서 PPF 잘하는 곳 알려줘",
  ],
} as const;

function fixtures() {
  const groups: Group[] = [];
  const areas: Area[] = [];
  for (const [intentType, questions] of Object.entries(intentExamples)) {
    const isPositive = ["local", "recommendation", "trust"].includes(intentType);
    groups.push({
      intentType,
      questionCount: 3,
      validCount: 3,
      confirmedMentionCount: isPositive ? 1 : 0,
      unresolvedTargetCount: 0,
    });
    questions.forEach((questionText, i) => {
      const positive = isPositive &&
        ((intentType === "trust" && i === 2) || (intentType !== "trust" && i === 1));
      areas.push({
        questionId: `${intentType}-question-${i}`,
        questionText,
        intentType,
        validCount: 1,
        confirmedMentionCount: positive ? 1 : 0,
        unresolvedTargetCount: 0,
      });
    });
  }
  return { groups, areas };
}

describe("Current Run: search context categories and exact saved questions", () => {
  it("matches all 8 stored intent groups, 3 questions each, and the exact 3 positives", () => {
    const { groups, areas } = fixtures();
    const result = buildSearchContextQuestionEvidence(groups, areas);
    expect(result).toHaveLength(8);
    expect(result.every((group) => group.questions?.length === 3)).toBe(true);
    expect(result.reduce((s, group) => s + group.questionCount, 0)).toBe(24);
    expect(result.reduce((s, group) => s + group.confirmedMentionCount, 0)).toBe(3);
    expect(result.filter((group) => group.confirmedMentionCount === 1)
      .map((group) => group.intentType)).toEqual(["local", "recommendation", "trust"]);

    expect(result.find((g) => g.intentType === "local")?.questions?.[1]?.questionText)
      .toBe("안산에서 PPF 맡기기 편한 업체 몇 곳 알려줘");
    expect(result.find((g) => g.intentType === "recommendation")?.questions?.[1]?.confirmedMentionCount)
      .toBe(1);
    expect(result.find((g) => g.intentType === "trust")?.questions?.[2]?.confirmedMentionCount)
      .toBe(1);

    // A '잘하는 곳' request was actually stored as service. Do NOT silently
    // reclassify that question as recommendation from the phrasing.
    expect(result.find((g) => g.intentType === "service")?.questions?.[2]?.questionText)
      .toBe("안산에서 PPF 잘하는 곳 알려줘");
    expect(INTENT_LABELS.service).toBe("서비스·작업");
  });

  it("does not invent a question breakdown if per-intent snapshots disagree", () => {
    const { groups, areas } = fixtures();
    expect(buildSearchContextQuestionEvidence(groups, areas.slice(1))[0]?.questions).toBeNull();
    expect(buildSearchContextQuestionEvidence(groups, [
      ...areas.slice(0, 1).map((q) => ({ ...q, confirmedMentionCount: 1 })),
      ...areas.slice(1),
    ])[0]?.questions).toBeNull();
    const wrongIntent = areas.map((a, i) => i === 1 ? { ...a, intentType: "service" } : a);
    const mismatched = buildSearchContextQuestionEvidence(groups, wrongIntent);
    expect(mismatched[0]?.questions).toBeNull();
    expect(mismatched.find((g) => g.intentType === "service")?.questions).toBeNull();
    const duplicateId = areas.map((a, i) => i === 1 ? { ...a, questionId: areas[0]!.questionId } : a);
    expect(buildSearchContextQuestionEvidence(groups, duplicateId)[0]?.questions).toBeNull();
    expect(buildSearchContextQuestionEvidence([...groups, groups[0]!], areas)[0]?.questions).toBeNull();
  });

  it("keeps unresolved, no-valid-answer and mixed observation states distinct", () => {
    const question: Area = {
      questionId: "test", questionText: "어느 업체?", intentType: "local",
      validCount: 1, confirmedMentionCount: 0, unresolvedTargetCount: 0,
    };
    expect(searchContextQuestionEvidenceLabel(question)).toBe("확정 노출 없음");
    expect(searchContextQuestionEvidenceLabel({ ...question, confirmedMentionCount: 1 }))
      .toBe("확정 노출 1/1");
    expect(searchContextQuestionEvidenceLabel({ ...question, unresolvedTargetCount: 1 }))
      .toBe("추가 확인 1/1");
    expect(searchContextQuestionEvidenceLabel({ ...question, validCount: 0 }))
      .toBe("유효 답변 없음");
    expect(searchContextQuestionEvidenceLabel({
      ...question, validCount: 3, confirmedMentionCount: 1, unresolvedTargetCount: 1,
    })).toBe("확정 1 · 추가 확인 1");
  });

  it("keeps original v2 chart bars authoritative and exposes printable saved-question evidence", () => {
    const at = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
    const dashboard = at("src/routes/_authenticated/dashboard.tsx");
    const helper = at("src/lib/search-context-question-evidence.ts");
    expect(dashboard).toContain("<SearchContextChart groups={model.questionGroups} questions={dto.questionAreas} />");
    expect(dashboard).toContain("buildSearchContextQuestionEvidence(groups, questions)");
    expect(dashboard).toContain("검색 상황별 실제 질문");
    expect(dashboard).toContain("질문 생성 시 지정한 검색 목적");
    expect(dashboard).toContain("질문 표현이 비슷해도 다른 유형에 포함될 수");
    expect(dashboard).toContain("<QuestionResults questions={group.questions}/>");
    expect(at("src/components/diagnostic-question-results.tsx")).toContain("questionPresentationGroups(questions)");
    expect(dashboard).toContain('className="diagnostic-questions mt-4 border-t pt-4"');
    expect(dashboard).toContain('dataKey="confirmed"');
    expect(dashboard).toContain('dataKey="unresolved"');
    expect(dashboard).toContain('dataKey="missing"');
    expect(dashboard).toContain("const data = groups.map((group) => ({");
    expect(helper).not.toContain("supabase");
    expect(helper).not.toContain("createServerFn");
    for (const forbidden of [".insert(", ".update(", ".delete(", ".upsert(", "enqueueRun(", "measurement_credit_accounts"]) {
      expect(helper).not.toContain(forbidden);
    }
  });
});
