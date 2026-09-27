/**
 * CHABOIM Action Opportunity Engine v0.1
 *
 * Converts benchmarked source-pattern gaps into customer-actionable review
 * opportunities. It never changes Entity Facts truth and never claims that
 * acting on a source will cause AI visibility to increase.
 */
import type {
  BenchmarkPatternStrength,
  BenchmarkSourceSiteDTO,
  VisibilityBenchmarkDTO,
} from "@/lib/visibility-benchmark.types";
import type { FirstPartySourceType } from "@/lib/first-party-source-classifier";

export const ACTION_OPPORTUNITY_ENGINE_VERSION = "0.1" as const;

export type ActionOpportunityKind =
  | "profile_directory"
  | "owned_web_presence"
  | "auto_platform"
  | "blog_presence"
  | "news_presence"
  | "video_presence"
  | "community_presence";

export type ActionOpportunityEvidenceScope = "category" | "global";
export type ActionOpportunitySignalStrength = "strong" | "moderate";

export type ActionOpportunityItem = {
  rank: number;
  kind: ActionOpportunityKind;
  sourceGroupKey: string;
  sourceGroupLabel: string;
  evidenceScope: ActionOpportunityEvidenceScope;
  signalStrength: ActionOpportunitySignalStrength;
  title: string;
  whyText: string;
  actionText: string;
  evidenceText: string;
  highEntityCount: number;
  highVisibilityEntityCount: number;
  highEntitySharePct: number | null;
  sites: BenchmarkSourceSiteDTO[];
};

export type ActionOpportunityEngineInput = {
  benchmark: VisibilityBenchmarkDTO | null;
  verifiedFirstPartySourceTypes?: readonly FirstPartySourceType[];
};

export type ActionOpportunityEngineResult = {
  version: typeof ACTION_OPPORTUNITY_ENGINE_VERSION;
  heading: "우선 확인해볼 차이";
  description: string;
  disclaimer: string;
  items: ActionOpportunityItem[];
};

type ActionableConfig = {
  kind: ActionOpportunityKind;
  directness: number;
};

const ACTIONABLE_GROUPS: Record<string, ActionableConfig> = {
  profile_directory: { kind: "profile_directory", directness: 1 },
  business_brand_site: { kind: "owned_web_presence", directness: 2 },
  auto_platform: { kind: "auto_platform", directness: 3 },
  blog: { kind: "blog_presence", directness: 4 },
  news: { kind: "news_presence", directness: 5 },
  video: { kind: "video_presence", directness: 6 },
  community: { kind: "community_presence", directness: 7 },
};

function signalOrder(value: ActionOpportunitySignalStrength): number {
  return value === "strong" ? 0 : 1;
}

function globalSignalStrength(args: {
  highEntityCount: number;
  highEntitySharePct: number | null;
  patternStrength: BenchmarkPatternStrength;
}): ActionOpportunitySignalStrength | null {
  const share = args.highEntitySharePct ?? 0;
  if (
    args.patternStrength === "established" &&
    args.highEntityCount >= 5 &&
    share >= 40
  ) {
    return "strong";
  }
  if (
    (args.patternStrength === "established" ||
      args.patternStrength === "emerging") &&
    args.highEntityCount >= 3 &&
    share >= 20
  ) {
    return "moderate";
  }
  return null;
}

function categorySignalStrength(args: {
  highEntityCount: number;
  highEntitySharePct: number | null;
}): ActionOpportunitySignalStrength | null {
  const share = args.highEntitySharePct ?? 0;
  if (args.highEntityCount >= 3 && share >= 50) return "strong";
  if (args.highEntityCount >= 2 && share >= 25) return "moderate";
  return null;
}

function pctText(value: number | null): string {
  return value === null ? "" : ` · ${value.toFixed(1)}%`;
}

function evidencePrefix(args: {
  scope: ActionOpportunityEvidenceScope;
  highEntityCount: number;
  highVisibilityEntityCount: number;
  highEntitySharePct: number | null;
}): string {
  const scopeLabel = args.scope === "category" ? "같은 업종" : "전체 자동차";
  return `${scopeLabel} 고노출 업체 ${args.highVisibilityEntityCount}곳 중 ${args.highEntityCount}곳${pctText(args.highEntitySharePct)}`;
}

function siteText(sites: readonly BenchmarkSourceSiteDTO[]): string {
  const labels = sites.map((site) => site.label).filter(Boolean).slice(0, 4);
  return labels.length > 0 ? labels.join(" · ") : "";
}

function customerCopy(args: {
  kind: ActionOpportunityKind;
  sites: BenchmarkSourceSiteDTO[];
  verifiedFirstPartySourceTypes: ReadonlySet<FirstPartySourceType>;
}): { title: string; actionText: string; sites: BenchmarkSourceSiteDTO[] } {
  const siteExamples = siteText(args.sites);

  switch (args.kind) {
    case "profile_directory":
      return {
        title: "업체 프로필·등록 채널에서 확인되는 차이",
        actionText:
          `같은 업종 고노출 업체에서는 ${siteExamples || "업체 프로필·등록 채널"} 같은 출처가 반복 관찰됐습니다. 실제 타업체 사례가 표시되면 링크를 열어 어떤 업체가 어떤 페이지로 연결되어 있는지 내 업체와 직접 비교해보세요.`,
        sites: args.sites.slice(0, 4),
      };
    case "owned_web_presence":
      return {
        title: "공식 홈페이지·브랜드 페이지 연결에서 확인되는 차이",
        actionText:
          "고노출 업체에서는 공식 홈페이지나 브랜드 페이지가 출처로 반복 관찰됐지만, 현재 내 업체에서는 같은 유형의 연결이 확인되지 않았습니다. 실제 사례가 표시되면 연결된 페이지 자체를 열어 어떤 정보가 AI 답변과 연결됐는지 비교해보세요.",
        // Benchmark examples here are often competitor-owned sites, so never
        // surface them as places the target business should edit.
        sites: [],
      };
    case "auto_platform":
      return {
        title: "자동차 전문 플랫폼 연결에서 확인되는 차이",
        actionText:
          `같은 업종 고노출 업체에서는 ${siteExamples || "자동차 전문 플랫폼"} 같은 출처가 반복 관찰됐습니다. 실제 사례가 표시되면 해당 업체의 실제 페이지를 열어 내 업체와 어떤 연결 차이가 있는지 확인해보세요.`,
        sites: args.sites.slice(0, 4),
      };
    case "blog_presence":
      return {
        title: "블로그 출처 연결에서 확인되는 차이",
        actionText:
          `${siteExamples || "블로그 채널"}에서 다른 업체와의 연결이 반복 관찰됐습니다. 실제 사례가 표시되면 연결된 페이지를 열어 내 업체와 어떤 차이가 있는지 직접 비교해보세요.`,
        sites: args.sites.slice(0, 4),
      };
    case "news_presence":
      return {
        title: "언론·뉴스 출처 연결에서 확인되는 차이",
        actionText:
          `${siteExamples || "언론·뉴스 출처"}에서 다른 업체와의 연결이 반복 관찰됐습니다. 실제 사례가 표시되면 어떤 기사나 페이지가 어떤 업체와 연결됐는지 확인해보세요.`,
        sites: args.sites.slice(0, 4),
      };
    case "video_presence":
      return {
        title: "영상 출처 연결에서 확인되는 차이",
        actionText:
          `${siteExamples || "영상 채널"}에서 다른 업체와의 연결이 반복 관찰됐습니다. 실제 사례가 표시되면 어떤 영상 페이지가 어떤 업체와 연결됐는지 확인해보세요.`,
        sites: args.sites.slice(0, 4),
      };
    case "community_presence":
      return {
        title: "커뮤니티 출처 연결에서 확인되는 차이",
        actionText:
          `${siteExamples || "커뮤니티"}에서 다른 업체와의 연결이 반복 관찰됐습니다. 실제 사례가 표시되면 어떤 페이지가 어떤 업체와 연결됐는지 확인해보세요.`,
        sites: args.sites.slice(0, 4),
      };
  }
}

type Candidate = {
  sourceGroupKey: string;
  sourceGroupLabel: string;
  evidenceScope: ActionOpportunityEvidenceScope;
  signalStrength: ActionOpportunitySignalStrength;
  highEntityCount: number;
  highVisibilityEntityCount: number;
  highEntitySharePct: number | null;
  sites: BenchmarkSourceSiteDTO[];
  directness: number;
  kind: ActionOpportunityKind;
};

function buildCandidates(
  benchmark: VisibilityBenchmarkDTO,
): Candidate[] {
  const globalByKey = new Map(
    benchmark.sourceGroups.map((group) => [group.key, group]),
  );
  const candidates: Candidate[] = [];

  for (const globalGroup of benchmark.sourceGroups) {
    const config = ACTIONABLE_GROUPS[globalGroup.key];
    if (!config) continue;
    if (globalGroup.targetConnected) continue;

    const category = benchmark.categoryContext;
    const categoryGroup =
      category?.available === true
        ? category.sourceGroups.find((group) => group.key === globalGroup.key)
        : undefined;

    if (
      category?.available === true &&
      category.highVisibilityEntityCount >= 3 &&
      categoryGroup
    ) {
      const categoryStrength = categorySignalStrength(categoryGroup);
      if (categoryStrength) {
        candidates.push({
          sourceGroupKey: globalGroup.key,
          sourceGroupLabel: categoryGroup.label,
          evidenceScope: "category",
          signalStrength: categoryStrength,
          highEntityCount: categoryGroup.highEntityCount,
          highVisibilityEntityCount: category.highVisibilityEntityCount,
          highEntitySharePct: categoryGroup.highEntitySharePct,
          sites: categoryGroup.sites,
          directness: config.directness,
          kind: config.kind,
        });
        continue;
      }
    }

    const globalStrength = globalSignalStrength({
      highEntityCount: globalGroup.highEntityCount,
      highEntitySharePct: globalGroup.highEntitySharePct,
      patternStrength: globalGroup.patternStrength,
    });
    if (!globalStrength) continue;

    candidates.push({
      sourceGroupKey: globalGroup.key,
      sourceGroupLabel: globalGroup.label,
      evidenceScope: "global",
      signalStrength: globalStrength,
      highEntityCount: globalGroup.highEntityCount,
      highVisibilityEntityCount: benchmark.highVisibilityEntityCount,
      highEntitySharePct: globalGroup.highEntitySharePct,
      sites: globalGroup.sites,
      directness: config.directness,
      kind: config.kind,
    });
  }

  return candidates.sort(
    (a, b) =>
      signalOrder(a.signalStrength) - signalOrder(b.signalStrength) ||
      a.directness - b.directness ||
      b.highEntityCount - a.highEntityCount ||
      (b.highEntitySharePct ?? 0) - (a.highEntitySharePct ?? 0) ||
      a.sourceGroupKey.localeCompare(b.sourceGroupKey, "en"),
  );
}

export function buildActionOpportunityEngineV01(
  input: ActionOpportunityEngineInput,
): ActionOpportunityEngineResult {
  const verifiedFirstPartySourceTypes = new Set(
    input.verifiedFirstPartySourceTypes ?? [],
  );

  if (!input.benchmark) {
    return {
      version: ACTION_OPPORTUNITY_ENGINE_VERSION,
      heading: "우선 확인해볼 차이",
      description: "아직 고노출 업체와 내 업체의 출처 연결 차이를 판단할 데이터가 충분하지 않습니다.",
      disclaimer:
        "관찰된 출처 연결 차이만 보여주며, 해당 차이가 AI 노출의 원인임을 의미하지 않습니다.",
      items: [],
    };
  }

  const candidates = buildCandidates(input.benchmark);
  const items = candidates.slice(0, 3).map((candidate, index) => {
    const copy = customerCopy({
      kind: candidate.kind,
      sites: candidate.sites,
      verifiedFirstPartySourceTypes,
    });
    const prefix = evidencePrefix({
      scope: candidate.evidenceScope,
      highEntityCount: candidate.highEntityCount,
      highVisibilityEntityCount: candidate.highVisibilityEntityCount,
      highEntitySharePct: candidate.highEntitySharePct,
    });

    return {
      rank: index + 1,
      kind: candidate.kind,
      sourceGroupKey: candidate.sourceGroupKey,
      sourceGroupLabel: candidate.sourceGroupLabel,
      evidenceScope: candidate.evidenceScope,
      signalStrength: candidate.signalStrength,
      title: copy.title,
      whyText: `${prefix}에서 ${candidate.sourceGroupLabel} 출처가 반복 관찰됐지만, 최근 측정에서 내 업체의 같은 출처 그룹 연결은 확인되지 않았습니다.`,
      actionText: copy.actionText,
      evidenceText: `${prefix} · 내 업체 연결 미확인`,
      highEntityCount: candidate.highEntityCount,
      highVisibilityEntityCount: candidate.highVisibilityEntityCount,
      highEntitySharePct: candidate.highEntitySharePct,
      sites: copy.sites,
    } satisfies ActionOpportunityItem;
  });

  return {
    version: ACTION_OPPORTUNITY_ENGINE_VERSION,
    heading: "우선 확인해볼 차이",
    description:
      "고노출 업체에서 반복 관찰됐지만 현재 내 업체에서는 같은 연결이 확인되지 않은 출처 차이만 보여드립니다.",
    disclaimer:
      "관찰된 출처 연결 차이를 바탕으로 한 확인 우선순위입니다. 이 차이가 AI 노출의 원인임을 의미하지 않으며, 등록·수정을 권하는 결과가 아닙니다.",
    items,
  };
}
