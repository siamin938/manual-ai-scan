/**
 * Entity Facts v2 "지금 어디부터 볼까요?" 고객용 우선순위 ViewModel (순수 함수).
 *
 * 입력은 EntityFactsV2ReadGatewayDTO 하나뿐이며, 서버가 확정한 집계 값만
 * 고객용 문구로 변환한다. 점수·가중치·추천 로직, legacy action 추천,
 * benchmark, clue-only 근거는 일절 사용하지 않는다.
 */
import { INTENT_LABELS } from "@/lib/question-suggestions";
import type { EntityFactsV2ReadGatewayDTO } from "@/lib/entity-facts-v2-read-gateway.types";

export const ENTITY_FACTS_V2_PRIORITY_VIEWMODEL_VERSION = "0.1" as const;

export type EntityFactsV2PriorityItemKind =
  | "confirmed_source_gap"
  | "identity_check"
  | "question_coverage_gap";

export type EntityFactsV2PriorityItem = {
  rank: number;
  kind: EntityFactsV2PriorityItemKind;
  title: string;
  whyText: string;
  actionText: string;
  evidenceText: string;
  sourceDomain?: string;
  intentTypes: string[];
};

export type EntityFactsV2PriorityViewModel = {
  version: typeof ENTITY_FACTS_V2_PRIORITY_VIEWMODEL_VERSION;
  heading: string;
  description: string;
  items: EntityFactsV2PriorityItem[];
};

function intentLabel(intentType: string): string {
  return (INTENT_LABELS as Record<string, string>)[intentType] ?? "기타";
}

type GroupEntry = { intentType: string; label: string };

function topLabels(entries: GroupEntry[], max = 3): string[] {
  return entries.slice(0, max).map((e) => e.label);
}

function intentScopeText(
  entries: GroupEntry[],
  suffix: "에서" | "에서는",
): string {
  const labels = topLabels(entries);
  const labelText = labels.join(", ");
  return entries.length > labels.length
    ? `${labelText} 등 여러 검색 상황${suffix}`
    : `${labelText} 질문${suffix}`;
}

function buildConfirmedSourceGap(
  dto: EntityFactsV2ReadGatewayDTO,
): EntityFactsV2PriorityItem | null {
  if (dto.observedSourcesStatus !== "available") return null;

  const candidates = dto.observedSources.filter(
    (s) =>
      s.targetResponseCount === 0 &&
      s.competitorResponseCount > 0 &&
      (s.evidence === "confirmed" || s.evidence === "mixed") &&
      s.linkedEntities.some(
        (e) => !e.isTarget && e.evidence === "confirmed",
      ),
  );
  if (candidates.length === 0) return null;

  const sorted = [...candidates].sort(
    (a, b) =>
      b.competitorResponseCount - a.competitorResponseCount ||
      b.responseCount - a.responseCount ||
      a.domain.localeCompare(b.domain),
  );
  const top = sorted[0];
  if (!top) return null;

  return {
    rank: 0,
    kind: "confirmed_source_gap",
    title: "함께 관찰된 업체가 연결된 출처부터 확인해보세요",
    whyText: `${top.domain}에서는 내 업체 연결이 확인되지 않았지만, 함께 관찰된 업체 연결이 AI 답변 ${top.competitorResponseCount}건에서 확인됐습니다.`,
    actionText:
      "이 출처에서 내 업체명·지점명·서비스 정보가 어떻게 보이는지 먼저 확인해보세요.",
    evidenceText: `${top.domain} · 함께 관찰된 업체 연결 ${top.competitorResponseCount}건`,
    sourceDomain: top.domain,
    intentTypes: [],
  };
}

function buildIdentityCheck(
  dto: EntityFactsV2ReadGatewayDTO,
): EntityFactsV2PriorityItem | null {
  const groups = dto.questionGroups.filter((g) => g.unresolvedTargetCount > 0);
  if (groups.length === 0) return null;

  const sorted = [...groups]
    .map((g) => ({ ...g, label: intentLabel(g.intentType) }))
    .sort(
      (a, b) =>
        b.unresolvedTargetCount - a.unresolvedTargetCount ||
        a.label.localeCompare(b.label, "ko"),
    );

  const totalUnresolved = sorted.reduce(
    (sum, g) => sum + g.unresolvedTargetCount,
    0,
  );
  const scopeText = intentScopeText(sorted, "에서");

  return {
    rank: 0,
    kind: "identity_check",
    title: "추가 확인이 필요한 질문부터 확인해보세요",
    whyText: `${scopeText} 내 업체와 동일한지 추가 확인이 필요한 응답이 있습니다.`,
    actionText:
      "업체명·지점명·서비스명이 여러 표현으로 잡히는지 확인해보세요.",
    evidenceText: `${sorted.length}개 검색 상황 · 추가 확인 ${totalUnresolved}건`,
    intentTypes: sorted.map((g) => g.intentType),
  };
}

function buildQuestionCoverageGap(
  dto: EntityFactsV2ReadGatewayDTO,
): EntityFactsV2PriorityItem | null {
  const groups = dto.questionGroups.filter(
    (g) =>
      g.confirmedMentionCount === 0 &&
      g.unresolvedTargetCount === 0 &&
      g.validCount > 0,
  );
  if (groups.length === 0) return null;

  const sorted = [...groups]
    .map((g) => ({ ...g, label: intentLabel(g.intentType) }))
    .sort(
      (a, b) =>
        b.validCount - a.validCount || a.label.localeCompare(b.label, "ko"),
    );

  const totalValid = sorted.reduce((sum, g) => sum + g.validCount, 0);
  const scopeText = intentScopeText(sorted, "에서는");

  return {
    rank: 0,
    kind: "question_coverage_gap",
    title: "노출이 확인되지 않은 질문 유형을 점검해보세요",
    whyText: `${scopeText} 이번 측정에서 내 업체의 확정 노출이 확인되지 않았습니다.`,
    actionText:
      "해당 서비스·전문성 정보가 홈페이지나 업체 프로필에 명확하게 드러나는지 확인해보세요.",
    evidenceText: `${sorted.length}개 검색 상황 · 총 ${totalValid}개 질문에서 확정 노출 없음`,
    intentTypes: sorted.map((g) => g.intentType),
  };
}

export function buildEntityFactsV2PriorityViewModel(
  dto: EntityFactsV2ReadGatewayDTO,
): EntityFactsV2PriorityViewModel {
  const items: EntityFactsV2PriorityItem[] = [
    buildConfirmedSourceGap(dto),
    buildIdentityCheck(dto),
    buildQuestionCoverageGap(dto),
  ]
    .filter((item): item is EntityFactsV2PriorityItem => item !== null)
    .slice(0, 3)
    .map((item, index) => ({ ...item, rank: index + 1 }));

  return {
    version: ENTITY_FACTS_V2_PRIORITY_VIEWMODEL_VERSION,
    heading: "지금 어디부터 볼까요?",
    description:
      "최근 측정에서 확인된 근거만으로 먼저 살펴볼 항목을 정리했습니다.",
    items,
  };
}
