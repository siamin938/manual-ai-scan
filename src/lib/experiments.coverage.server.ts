// Core Engine Isolation: Coverage → Experiment 생성은 Supabase Edge Function
// `profile-coverage-recommendation` (mode: "create_experiment")이 전담한다.
// 이 파일은 현재 사용자 JWT로 최소 식별자만 보내고 결과 DTO를 매핑하는 wrapper다.
// 이 저장소에서 상태 판정/실험 문구 생성/INSERT를 수행하지 않는다.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { CreateCoverageExperimentResult } from "./profile-coverage.helpers";
import { requestCoverageExperimentCreation } from "./profile-coverage.recommendation.server";

type UserClient = SupabaseClient<Database>;

/** 브라우저 입력은 orgId + profileCoverageItemId만 신뢰한다. 검증은 Edge Function이 수행한다. */
export async function createExperimentFromCoverageItemImpl(args: {
  supabase: UserClient;
  userId: string;
  orgId: string;
  profileCoverageItemId: string;
}): Promise<CreateCoverageExperimentResult> {
  return requestCoverageExperimentCreation({
    supabase: args.supabase,
    orgId: args.orgId,
    profileCoverageItemId: args.profileCoverageItemId,
  });
}
