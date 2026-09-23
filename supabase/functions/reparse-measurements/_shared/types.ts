// RECONSTRUCTED_COMPILE_ONLY
// The deployed Supabase runtime bundle omits this type-only module because it has
// no runtime effect. These declarations were reconstructed only from the exact
// deployed runtime imports/usages recovered on 2026-09-13. Do not treat this
// file as a byte-for-byte copy of the lost original source.

export type ParseConfidence = "low" | "medium" | "high";

export interface ProviderSource {
  url: string;
  domain?: string;
  title?: string;
}

export interface BusinessForParsing {
  id: string;
  name: string;
  aliases: string[];
  officialDomains: string[];
  isClient: boolean;
}

export interface ParsedMention {
  businessId?: string;
  displayName: string;
  matchedAlias?: string;
  position: number;
  explicitRank: boolean;
  confidence: ParseConfidence;
}

export interface ParsedMeasurement {
  valid: boolean;
  invalidReason?: string;
  wasClientMentioned: boolean;
  clientPosition?: number;
  clientDomainCited: boolean;
  parseConfidence: ParseConfidence;
  manualReviewRequired: boolean;
  mentions: ParsedMention[];
}
