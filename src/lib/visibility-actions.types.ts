// Core Engine Isolation: 추천 순위/근거 수준/문구는 모두 서버가 결정한다.
// 이 파일은 Edge Function `visibility-action-recommendations`의 응답 계약 타입만 정의한다.

export type ActionEvidenceLevel = "priority_try" | "worth_review" | "observe_more";

export type ActionRecommendationEvidenceDTO = {
  clientResponseCount: number;
  competitorResponseCount: number;
  distinctCompetitorCount: number;
  measurementCount: number;
  questionCount: number;
  domains: string[];
};

export type ActionChannelActionType =
  | "publish_candidate"
  | "profile_check"
  | "platform_check"
  | "community_check"
  | "conditional_pr"
  | "observe_only";

export type ActionChannelSuggestionDTO = {
  key: string;
  name: string;
  actionType: ActionChannelActionType;
  actionLabel: string;
  reason: string;
  responseCount: number;
  relatedResponseTotal: number;
  citationCount: number;
  distinctCompetitorCount: number;
  domains: string[];
};

export type ActionRecommendationDTO = {
  id: string;
  rank: number;
  kind: "source_gap" | "intent_gap";
  title: string;
  evidenceLevel: ActionEvidenceLevel;
  evidenceLabel: string;
  summary: string;
  steps: string[];
  sampleQuestions: string[];
  evidence: ActionRecommendationEvidenceDTO;
  channelSuggestions: ActionChannelSuggestionDTO[];
};

export type ActionScopeDTO = {
  runId: string;
  runName: string;
  measuredAt: string;
  repetitions: number;
  validCount: number;
  competitorCount: number;
};

export type ActionRecommendationsDTO = {
  generatedAt: string;
  business: { id: string; name: string };
  scope: ActionScopeDTO | null;
  recommendations: ActionRecommendationDTO[];
  disclaimer: string;
};

export type ActionRecommendationsErrorCode = "FORBIDDEN" | "INVALID_DTO" | "INTERNAL_ERROR";

export type ActionRecommendationsResponseDTO =
  | { ok: true; data: ActionRecommendationsDTO }
  | { ok: false; error: ActionRecommendationsErrorCode };
