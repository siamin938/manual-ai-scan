/**
 * Entity Facts v2 Priority v0.2 — evidence-first customer guidance.
 *
 * This is a pure presentation ViewModel over EntityFactsV2ReadGatewayDTO.
 * It does not score, mutate, or reinterpret Entity Facts truth.
 */
import { INTENT_LABELS } from "@/lib/question-suggestions";
import type {
  EntityFactsV2ReadGatewayDTO,
  EntityFactsV2ReadQuestionAreaDTO,
} from "@/lib/entity-facts-v2-read-gateway.types";

export const ENTITY_FACTS_V2_PRIORITY_V02_VERSION = "0.2" as const;

export type EntityFactsV2PriorityV02Kind =
  | "confirmed_source_gap"
  | "visible_not_top3"
  | "identity_uncertain"
  | "missing_questions";

export type EntityFactsV2PriorityV02Example = {
  questionText: string;
  intentType: string;
  intentLabel: string;
};

export type EntityFactsV2PriorityV02Item = {
  rank: number;
  kind: EntityFactsV2PriorityV02Kind;
  title: string;
  summaryText: string;
  actionText: string;
  evidenceText: string;
  sourceDomain?: string;
  examples: EntityFactsV2PriorityV02Example[];
};

export type EntityFactsV2PriorityV02ViewModel = {
  version: typeof ENTITY_FACTS_V2_PRIORITY_V02_VERSION;
  heading: "지금 어디부터 볼까요?";
  description: string;
  items: EntityFactsV2PriorityV02Item[];
};

function intentLabel(intentType: string): string {
  return (INTENT_LABELS as Record<string, string>)[intentType] ?? "기타";
}

function examples(
  rows: EntityFactsV2ReadQuestionAreaDTO[],
  max = 2,
): EntityFactsV2PriorityV02Example[] {
  return rows.slice(0, max).map((row) => ({
    questionText: row.questionText,
    intentType: row.intentType,
    intentLabel: intentLabel(row.intentType),
  }));
}

function questionOrder(
  a: EntityFactsV2ReadQuestionAreaDTO,
  b: EntityFactsV2ReadQuestionAreaDTO,
): number {
  return (
    b.confirmedMentionCount - a.confirmedMentionCount ||
    b.unresolvedTargetCount - a.unresolvedTargetCount ||
    intentLabel(a.intentType).localeCompare(intentLabel(b.intentType), "ko") ||
    a.questionText.localeCompare(b.questionText, "ko")
  );
}

function buildSourceGap(
  dto: EntityFactsV2ReadGatewayDTO,
): EntityFactsV2PriorityV02Item | null {
  if (dto.observedSourcesStatus !== "available") return null;

  const source = [...dto.observedSources]
    .filter(
      (item) =>
        item.targetResponseCount === 0 &&
        item.competitorResponseCount > 0 &&
        (item.evidence === "confirmed" || item.evidence === "mixed") &&
        item.linkedEntities.some(
          (entity) => !entity.isTarget && entity.evidence === "confirmed",
        ),
    )
    .sort(
      (a, b) =>
        b.competitorResponseCount - a.competitorResponseCount ||
        b.responseCount - a.responseCount ||
        a.domain.localeCompare(b.domain, "en"),
    )[0];

  if (!source) return null;

  return {
    rank: 0,
    kind: "confirmed_source_gap",
    title: "경쟁 업체는 연결됐지만 내 업체는 보이지 않는 출처가 있습니다",
    summaryText: `${source.domain}에서 함께 관찰된 업체 연결은 ${source.competitorResponseCount}건 확인됐지만 내 업체 연결은 0건입니다.`,
    actionText:
      "이 출처에서 내 업체명·지점명·서비스 정보가 실제로 어떻게 보이는지 먼저 확인해보세요.",
    evidenceText: `${source.domain} · 함께 관찰된 업체 연결 ${source.competitorResponseCount}건 · 내 업체 연결 0건`,
    sourceDomain: source.domain,
    examples: [],
  };
}

function buildVisibleNotTop3(
  dto: EntityFactsV2ReadGatewayDTO,
): EntityFactsV2PriorityV02Item | null {
  const rows = dto.questionAreas
    .filter(
      (item) =>
        item.confirmedMentionCount > 0 &&
        item.confirmedTop3Count === 0 &&
        item.top3UncertainCount === 0,
    )
    .slice()
    .sort(questionOrder);

  if (rows.length === 0) return null;

  return {
    rank: 0,
    kind: "visible_not_top3",
    title: "AI에는 보이지만 상위 3곳에는 확인되지 않은 질문이 있습니다",
    summaryText: `${rows.length}개 질문에서 내 업체 노출은 확인됐지만 상위 3곳 노출은 확인되지 않았습니다.`,
    actionText:
      "대표 질문에서 강조되는 서비스·경험·후기 정보가 홈페이지나 업체 프로필에 충분히 드러나는지 확인해보세요.",
    evidenceText: `${rows.length}개 질문 · 내 업체 노출 확인 · 상위 3곳 노출 미확인`,
    examples: examples(rows),
  };
}

function buildIdentityUncertain(
  dto: EntityFactsV2ReadGatewayDTO,
): EntityFactsV2PriorityV02Item | null {
  const rows = dto.questionAreas
    .filter((item) => item.unresolvedTargetCount > 0)
    .slice()
    .sort(questionOrder);

  if (rows.length === 0) return null;

  const unresolvedResponses = rows.reduce(
    (sum, row) => sum + row.unresolvedTargetCount,
    0,
  );

  return {
    rank: 0,
    kind: "identity_uncertain",
    title: "내 업체인지 확정하지 못한 답변이 있습니다",
    summaryText: `${rows.length}개 질문에서 내 업체일 가능성은 있었지만 같은 업체라고 확정하지 못한 응답 ${unresolvedResponses}건이 있습니다.`,
    actionText:
      "대표 질문을 기준으로 홈페이지·네이버 플레이스·업체 프로필의 업체명, 지점명, 대표 서비스명이 일관되게 표시되는지 확인해보세요.",
    evidenceText: `${rows.length}개 질문 · 업체 동일성 추가 확인 ${unresolvedResponses}건`,
    examples: examples(rows),
  };
}

function buildMissingQuestions(
  dto: EntityFactsV2ReadGatewayDTO,
): EntityFactsV2PriorityV02Item | null {
  const rows = dto.questionAreas
    .filter(
      (item) =>
        item.validCount > 0 &&
        item.confirmedMentionCount === 0 &&
        item.unresolvedTargetCount === 0,
    )
    .slice()
    .sort((a, b) => {
      return (
        intentLabel(a.intentType).localeCompare(intentLabel(b.intentType), "ko") ||
        a.questionText.localeCompare(b.questionText, "ko")
      );
    });

  if (rows.length === 0) return null;

  const validResponses = rows.reduce((sum, row) => sum + row.validCount, 0);

  return {
    rank: 0,
    kind: "missing_questions",
    title: `질문 ${rows.length}개에서 아직 노출이 확인되지 않았습니다`,
    summaryText:
      "이번 측정에서 아래 대표 질문들에는 내 업체가 한 번도 확정 노출되지 않았습니다.",
    actionText:
      "대표 질문과 관련된 서비스·경험·후기 정보가 홈페이지나 업체 프로필에 실제로 충분히 적혀 있는지 확인해보세요.",
    evidenceText: `${rows.length}개 질문 · 총 ${validResponses}개 유효 응답 모두 노출 미확인`,
    examples: examples(rows),
  };
}

export function buildEntityFactsV2PriorityV02ViewModel(
  dto: EntityFactsV2ReadGatewayDTO,
): EntityFactsV2PriorityV02ViewModel {
  const candidates = [
    buildSourceGap(dto),
    buildVisibleNotTop3(dto),
    buildIdentityUncertain(dto),
    buildMissingQuestions(dto),
  ].filter((item): item is EntityFactsV2PriorityV02Item => item !== null);

  return {
    version: ENTITY_FACTS_V2_PRIORITY_V02_VERSION,
    heading: "지금 어디부터 볼까요?",
    description:
      "이번 측정에서 가장 구체적으로 확인할 수 있는 근거부터 최대 3개만 보여드립니다.",
    items: candidates.slice(0, 3).map((item, index) => ({
      ...item,
      rank: index + 1,
    })),
  };
}
