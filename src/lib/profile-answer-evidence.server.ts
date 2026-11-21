import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { CUSTOMER_STANDARD_QUESTION_COUNT } from "./customer-measurement.helpers";
import { ENTITY_FACTS_V2_READ_ENGINE_VERSION, ENTITY_FACTS_V2_READ_FACT_VERSION, type EntityFactsV2ReadGatewayDTO } from "./entity-facts-v2-read-gateway.types";
import { collectAnswerSignals, type CitationSpan, type ProfileAnswerEvidence } from "./profile-answer-signals";

export async function readProfileAnswerEvidence(orgId: string, dto: EntityFactsV2ReadGatewayDTO, rows: readonly CitationSpan[]): Promise<Map<string, ProfileAnswerEvidence>> {
  // Optional explanation only. Old runs and incomplete snapshots keep the existing guide.
  if (!rows.length || dto.overview.measurementCount !== CUSTOMER_STANDARD_QUESTION_COUNT) return new Map();
  const limit = CUSTOMER_STANDARD_QUESTION_COUNT + 1;
  const [answers, facts] = await Promise.all([
    supabaseAdmin.from("measurements").select("id, question_id, response_text")
      .eq("org_id", orgId).eq("run_id", dto.scope.runId).eq("valid", true).limit(limit),
    supabaseAdmin.from("measurement_entity_facts_v2").select("measurement_id, materialization_id, keys:facts->confirmedOtherEntityKeys, valid:facts->valid")
      .eq("org_id", orgId).eq("business_id", dto.business.id).eq("source_run_id", dto.scope.runId)
      .eq("fact_version", ENTITY_FACTS_V2_READ_FACT_VERSION).eq("engine_version", ENTITY_FACTS_V2_READ_ENGINE_VERSION).limit(limit),
  ]);
  if (answers.error || facts.error || answers.data.length !== dto.overview.validCount ||
      facts.data.length !== dto.overview.measurementCount || new Set(facts.data.map(f => f.materialization_id)).size !== 1 ||
      new Set(facts.data.map(f => f.measurement_id)).size !== facts.data.length) return new Map();
  const byId = new Map(facts.data.map(f => [f.measurement_id, f]));
  const scoped = new Map<string, {questionId: string; text: string; confirmedKeys: string[]}>();
  for (const answer of answers.data) {
    const fact = byId.get(answer.id);
    if (fact?.valid !== true || !Array.isArray(fact.keys) || !answer.response_text) continue;
    scoped.set(answer.id, { questionId: answer.question_id, text: answer.response_text,
      confirmedKeys: fact.keys.filter((key): key is string => typeof key === "string") });
  }
  return collectAnswerSignals(rows, scoped, [dto.business.name, ...dto.competitors.map(peer => peer.name)],
    new Set(dto.questionAreas.filter(q => q.validCount > 0 && q.confirmedMentionCount === 0 && q.unresolvedTargetCount === 0).map(q => q.questionId)));
}
