// Shadow-only market question generator.
// Production suggest-questions is intentionally NOT connected to this function yet.
// Provider-Answer Gate v0.1 contract:
// 1) preserve fixed market slot (intent/service/location),
// 2) never mention target business,
// 3) require a question whose useful answer names actual providers/businesses,
// 4) reject generic advice/checklist questions,
// 5) repair failed slots only, max 2 attempts,
// 6) never persist generated questions to live question_sets/questions.
//
// The deployed one-time validation function uses the same gate contract during shadow evaluation.
// Full production integration remains blocked until cross-business shadow validation passes.

export const MARKET_SHADOW_PROVIDER_ANSWER_GATE_VERSION = "0.1";
export const MARKET_SHADOW_MAX_REPAIR_ATTEMPTS = 2;

export const PROVIDER_ANSWER_GATE_NOTES = [
  "actual provider/business names must be required by the question",
  "generic advice/checklist-only answers are rejected",
  "market slot intent/service/location must remain unchanged",
  "target business name must never appear",
  "failed slots may be repaired at most twice",
  "shadow results are not persisted to live questions",
] as const;
