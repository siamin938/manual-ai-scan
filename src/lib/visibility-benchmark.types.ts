// Core Engine Isolation: `visibility-benchmark` Edge Function이 계산한
// 고노출 업체 공통 출처 패턴 DTO. 이 저장소에는 판정/집계 규칙이 없다.

export type BenchmarkDataStatus = "early" | "ready";

/** "early"는 초기 표본, 그 외(emerging 이상)는 반복 관찰 단계로만 해석한다. */
export type BenchmarkPatternStrength = "early" | "emerging" | "established";

export interface BenchmarkSourceSiteDTO {
  label: string;
  domain?: string;
}

export interface BenchmarkSourceGroupDTO {
  key: string;
  label: string;
  highEntityCount: number;
  highEntitySharePct: number | null;
  /** 대상 업체가 이 출처 그룹과 연결 관찰됐는지 여부(관찰값, 인과 아님). */
  targetConnected: boolean;
  patternStrength: BenchmarkPatternStrength;
  sites: BenchmarkSourceSiteDTO[];
}


export interface VisibilityBenchmarkDTO {
  windowDays: number;
  thresholdPct: number;
  dataStatus: BenchmarkDataStatus;
  highVisibilityEntityCount: number;
  sourceGroups: BenchmarkSourceGroupDTO[];
  disclaimer: string;
}

export type VisibilityBenchmarkResponseDTO =
  | { ok: true; benchmark: VisibilityBenchmarkDTO | null }
  | { ok: false; error: string };
