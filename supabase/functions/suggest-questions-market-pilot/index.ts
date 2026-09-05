// Internal-only market question pilot adapter.
// Deployed Edge Function is the runtime source of truth during the pilot.
// Contract:
// - verify_jwt=true
// - requires organization membership
// - requires get_measurement_market_feature_flag_v01 => enabled + internal_pilot
// - DB forces non-internal organizations to OFF
// - calls the validated shadow market generator
// - converts 24 shadow questions to the existing suggest-questions PublicSuggestion DTO
// - requires exactly 3 questions for each of 8 canonical intents
// - does NOT persist question_sets/questions
// - does NOT silently fall back to the legacy generator
// - does NOT run measurements or consume measurement credits

export const MARKET_PILOT_MODE = "visibility_market_pilot_v0_1";
export const MARKET_PROFILE_VERSION = "0.2";
export const STANDARD_QUESTION_COUNT = 24;
export const MARKET_PILOT_PERSISTS_QUESTIONS = false;
export const MARKET_PILOT_LIVE_GENERATOR_CONNECTED = false;
