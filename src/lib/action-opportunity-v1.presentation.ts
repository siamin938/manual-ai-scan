import type { ActionOpportunityV1Item } from "./action-opportunity-v1.rules";

/**
 * Presentation only: preserve the exact Run's full set of verified/advisory
 * opportunities, but avoid presenting every long card at once in internal QA.
 *
 * The engine order is preserved. This is NOT a predicted improvement score,
 * strength-of-causality ranking, or reason to hide any observation permanently.
 */
export type ActionOpportunityV1Presentation = {
  primary: ActionOpportunityV1Item[];
  additional: ActionOpportunityV1Item[];
};

const VISIBLE_FIRST_ITEMS = 2;

export function splitActionOpportunityV1Items(
  items: readonly ActionOpportunityV1Item[],
): ActionOpportunityV1Presentation {
  return {
    primary: items.slice(0, VISIBLE_FIRST_ITEMS),
    additional: items.slice(VISIBLE_FIRST_ITEMS),
  };
}
