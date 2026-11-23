/**
 * Shared source-domain classifier for evidence policy.
 *
 * This module classifies source hosts by source type only. It never decides
 * whether a domain belongs to a particular business and contains no
 * business-specific allow/deny exceptions.
 */

export const SOURCE_DOMAIN_CLASSIFIER_VERSION = "0.1" as const;

export type SourceDomainClass =
  | "unknown"
  | "infrastructure"
  | "shared_profile"
  | "community"
  | "auto_platform"
  | "video_platform"
  | "news"
  | "job_board"
  | "public_information"
  | "brand_or_manufacturer"
  | "marketplace_or_directory"
  | "independent_web";

export interface SourceDomainClassification {
  version: typeof SOURCE_DOMAIN_CLASSIFIER_VERSION;
  domain: string;
  class: SourceDomainClass;
  strongCompetitorIdentityEligible: boolean;
}

const JOB_BOARD_HOSTS = new Set([
  "saramin.co.kr",
  "jobkorea.co.kr",
  "albamon.com",
  "alba.co.kr",
  "career.co.kr",
  "jobplanet.co.kr",
  "work24.go.kr",
  "govjob.co.kr",
]);

const NEWS_HOSTS = new Set([
  "newsis.com",
  "v.daum.net",
  "n.news.naver.com",
  "news.nate.com",
  "yna.co.kr",
  "wowtv.co.kr",
]);

const BRAND_OR_MANUFACTURER_HOSTS = new Set([
  "shop.tesla.com",
  "xpelkorea.com",
]);

const MARKETPLACE_OR_DIRECTORY_HOSTS = new Set([
  "daangn.com",
  "tintingstore.com",
  "car.infofafa.com",
  "car.finance-information.net",
]);

export function normalizeSourceDomain(
  value: string | null | undefined,
): string {
  const raw = (value ?? "").trim().toLowerCase();
  if (!raw) return "";

  try {
    const parsed = new URL(
      /^https?:\/\//u.test(raw) ? raw : `https://${raw}`,
    );
    return parsed.hostname.replace(/^www\./u, "");
  } catch {
    return raw
      .replace(/^www\./u, "")
      .replace(/[/?#].*$/u, "")
      .replace(/\.$/u, "");
  }
}

export function isInfrastructureSourceDomain(
  value: string | null | undefined,
): boolean {
  const domain = normalizeSourceDomain(value);
  return (
    domain === "s3.amazonaws.com" ||
    domain.endsWith(".s3.amazonaws.com") ||
    /\.s3[.-][^.]+\.amazonaws\.com$/u.test(domain) ||
    domain === "storage.googleapis.com" ||
    domain.endsWith(".blob.core.windows.net") ||
    domain.endsWith(".r2.cloudflarestorage.com") ||
    domain.endsWith(".digitaloceanspaces.com")
  );
}

function hostOrSubdomain(domain: string, host: string): boolean {
  return domain === host || domain.endsWith(`.${host}`);
}

export function classifySourceDomain(
  value: string | null | undefined,
): SourceDomainClassification {
  const domain = normalizeSourceDomain(value);

  if (!domain) {
    return {
      version: SOURCE_DOMAIN_CLASSIFIER_VERSION,
      domain: "",
      class: "unknown",
      strongCompetitorIdentityEligible: false,
    };
  }

  if (isInfrastructureSourceDomain(domain)) {
    return {
      version: SOURCE_DOMAIN_CLASSIFIER_VERSION,
      domain,
      class: "infrastructure",
      strongCompetitorIdentityEligible: false,
    };
  }

  if (
    domain === "pf.kakao.com" ||
    domain === "place.naver.com" ||
    domain === "m.place.naver.com" ||
    domain === "map.naver.com"
  ) {
    return {
      version: SOURCE_DOMAIN_CLASSIFIER_VERSION,
      domain,
      class: "shared_profile",
      strongCompetitorIdentityEligible: false,
    };
  }

  if (
    domain === "blog.naver.com" ||
    domain === "cafe.naver.com" ||
    hostOrSubdomain(domain, "tistory.com")
  ) {
    return {
      version: SOURCE_DOMAIN_CLASSIFIER_VERSION,
      domain,
      class: "community",
      strongCompetitorIdentityEligible: false,
    };
  }

  if (hostOrSubdomain(domain, "oh-car.kr")) {
    return {
      version: SOURCE_DOMAIN_CLASSIFIER_VERSION,
      domain,
      class: "auto_platform",
      strongCompetitorIdentityEligible: false,
    };
  }

  if (
    domain === "youtube.com" ||
    domain === "youtu.be" ||
    hostOrSubdomain(domain, "youtube.com")
  ) {
    return {
      version: SOURCE_DOMAIN_CLASSIFIER_VERSION,
      domain,
      class: "video_platform",
      strongCompetitorIdentityEligible: false,
    };
  }

  if (NEWS_HOSTS.has(domain)) {
    return {
      version: SOURCE_DOMAIN_CLASSIFIER_VERSION,
      domain,
      class: "news",
      strongCompetitorIdentityEligible: false,
    };
  }

  if (JOB_BOARD_HOSTS.has(domain)) {
    return {
      version: SOURCE_DOMAIN_CLASSIFIER_VERSION,
      domain,
      class: "job_board",
      strongCompetitorIdentityEligible: false,
    };
  }

  if (domain.endsWith(".go.kr")) {
    return {
      version: SOURCE_DOMAIN_CLASSIFIER_VERSION,
      domain,
      class: "public_information",
      strongCompetitorIdentityEligible: false,
    };
  }

  if (BRAND_OR_MANUFACTURER_HOSTS.has(domain)) {
    return {
      version: SOURCE_DOMAIN_CLASSIFIER_VERSION,
      domain,
      class: "brand_or_manufacturer",
      strongCompetitorIdentityEligible: false,
    };
  }

  if (
    MARKETPLACE_OR_DIRECTORY_HOSTS.has(domain) ||
    hostOrSubdomain(domain, "daangn.com")
  ) {
    return {
      version: SOURCE_DOMAIN_CLASSIFIER_VERSION,
      domain,
      class: "marketplace_or_directory",
      strongCompetitorIdentityEligible: false,
    };
  }

  return {
    version: SOURCE_DOMAIN_CLASSIFIER_VERSION,
    domain,
    class: "independent_web",
    strongCompetitorIdentityEligible: true,
  };
}

export function isStrongCompetitorIdentityCorroborationDomain(
  value: string | null | undefined,
): boolean {
  return classifySourceDomain(value).strongCompetitorIdentityEligible;
}
