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
  heading: "지금 내가 해볼 만한 것";
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
    args.highEntityCount >= 3
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
    case "profile_directory": {
      const naverPlaceKnown = args.verifiedFirstPartySourceTypes.has("naver_place");
      return {
        title: "업체 프로필·디렉터리 채널을 우선 점검해보세요",
        actionText: naverPlaceKnown
          ? `네이버 플레이스는 이미 확인되어 있습니다. 기존 프로필의 업체명·주소·대표 서비스·공식 링크를 최신 상태로 맞추고, ${siteExamples || "추가 디렉터리 채널"} 중 아직 활용하지 않는 채널이 있는지 확인해보세요.`
          : `${siteExamples || "업체 프로필·디렉터리 채널"}에서 내 업체 등록·노출 여부를 확인하고, 등록돼 있다면 업체명·주소·대표 서비스·공식 링크가 최신인지 점검해보세요.`,
        sites: args.sites.slice(0, 4),
      };
    }
    case "owned_web_presence": {
      const ownedDomainKnown = args.verifiedFirstPartySourceTypes.has("owned_domain");
      return {
        title: "공식 홈페이지·자사 페이지의 정보 연결을 점검해보세요",
        actionText: ownedDomainKnown
          ? "이미 공식 도메인이 확인되어 있습니다. 업체명·지역·주요 서비스·연락처와 공식 프로필 링크가 페이지에서 명확하고 일관되게 표시되는지 점검해보세요."
          : "경쟁업체 홈페이지에 등록하라는 의미가 아닙니다. 내 공식 홈페이지나 브랜드·가맹점 페이지가 있다면 업체명·지역·주요 서비스·연락처와 공식 프로필 링크가 명확하게 표시되는지 확인해보세요.",
        // Benchmark examples here are often competitor-owned sites, so never
        // surface them as places the target business should edit.
        sites: [],
      };
    }
    case "auto_platform":
      return {
        title: "자동차 전문 플랫폼에서 내 업체 노출 경로를 확인해보세요",
        actionText: `${siteExamples || "자동차 전문 플랫폼"}에서 업체 등록·프로필·시공점 정보 노출이 가능한지 확인하고, 가능하다면 현재 정보가 정확한지 점검해보세요.`,
        sites: args.sites.slice(0, 4),
      };
    case "blog_presence": {
      const naverBlogKnown = args.verifiedFirstPartySourceTypes.has("naver_blog");
      return {
        title: "블로그에서 업체 정보가 반복적으로 확인될 기반을 점검해보세요",
        actionText: naverBlogKnown
          ? "이미 확인된 네이버 블로그가 있습니다. 업체명·지역·대표 서비스가 명확한 공개 콘텐츠와 프로필 정보가 유지되고 있는지 점검해보세요."
          : `${siteExamples || "네이버 블로그·티스토리"} 등 공개 블로그 채널에서 업체명·지역·대표 서비스가 명확한 정보가 있는지 확인해보세요.`,
        sites: args.sites.slice(0, 4),
      };
    }
    case "news_presence":
      return {
        title: "언론·뉴스 등 외부 신뢰 출처 확보 가능성을 검토해보세요",
        actionText: `${siteExamples || "언론·뉴스 채널"}처럼 독립된 외부 출처에서 실제 취재·소개·전문 정보로 노출될 수 있는 소재가 있는지 검토해보세요. 유료 노출이나 보도자료만을 의미하지는 않습니다.`,
        sites: args.sites.slice(0, 4),
      };
    case "video_presence":
      return {
        title: "영상 채널에서 업체·서비스 정보가 확인될 수 있는지 점검해보세요",
        actionText: `${siteExamples || "영상 채널"}에서 작업 과정·서비스 설명·업체 정보를 공개적으로 확인할 수 있는 콘텐츠가 있는지 점검해보세요.`,
        sites: args.sites.slice(0, 4),
      };
    case "community_presence":
      return {
        title: "커뮤니티에서 업체 정보가 자연스럽게 확인되는지 살펴보세요",
        actionText: `${siteExamples || "커뮤니티"}에서 실제 이용 정보나 업체 정보가 확인되는지 살펴보세요. 인위적인 후기·홍보 게시물 작성을 권하는 항목은 아닙니다.`,
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
      heading: "지금 내가 해볼 만한 것",
      description: "아직 반복 출처 패턴을 판단할 데이터가 충분하지 않습니다.",
      disclaimer:
        "특정 채널 작업이 AI 노출 상승을 보장하지 않습니다. 반복 관찰 패턴이 충분할 때만 점검 후보를 제공합니다.",
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
    heading: "지금 내가 해볼 만한 것",
    description:
      "고노출 업체에서 반복 관찰되지만 현재 내 업체에서는 확인되지 않은, 실제로 점검 가능한 채널만 추렸습니다.",
    disclaimer:
      "반복 관찰 패턴을 바탕으로 한 점검 우선순위이며, 특정 채널의 등록·수정이 AI 노출 상승을 보장하지는 않습니다.",
    items,
  };
}
