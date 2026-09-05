# suggest-questions-router

Runtime contract as of 2026-09-05:

- `verify_jwt=true`
- validates organization membership
- reads server-only measurement market feature flag
- flag OFF: forwards to existing `suggest-questions` v19 unchanged
- `internal_pilot` ON: runs Market Generator directly in the router process
- the pilot path no longer calls `suggest-questions-market-pilot` or `suggest-questions-market-shadow-once`
- direct market path: `market_profile_v0.2 -> 24 slots -> OpenAI naturalization -> Provider-Answer Gate v0.1 -> Semantic Diversity Gate v0.1`
- pilot failure does not silently fall back to legacy
- non-internal organizations are forced OFF by DB function
- market pilot questions are returned using the existing PublicSuggestion DTO
- the router does not persist question sets/questions, start measurements, or consume measurement credits

The existing production `suggest-questions` implementation is intentionally preserved.
