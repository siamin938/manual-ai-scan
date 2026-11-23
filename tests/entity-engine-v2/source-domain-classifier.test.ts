import { describe, expect, it } from "vitest";
import {
  SOURCE_DOMAIN_CLASSIFIER_VERSION,
  classifySourceDomain,
  isInfrastructureSourceDomain,
  isStrongCompetitorIdentityCorroborationDomain,
  normalizeSourceDomain,
} from "../../src/lib/source-domain-classifier";

describe("source domain classifier", () => {
  it("normalizes hosts and URLs deterministically", () => {
    expect(normalizeSourceDomain("https://WWW.Example.com/path?q=1")).toBe(
      "example.com",
    );
    expect(normalizeSourceDomain("WWW.Example.com")).toBe("example.com");
    expect(normalizeSourceDomain("")).toBe("");
  });

  it("keeps independent business-like web domains eligible without allowlisting them", () => {
    expect(classifySourceDomain("kugs.net")).toEqual({
      version: SOURCE_DOMAIN_CLASSIFIER_VERSION,
      domain: "kugs.net",
      class: "independent_web",
      strongCompetitorIdentityEligible: true,
    });
    expect(isStrongCompetitorIdentityCorroborationDomain("tstylelab.com")).toBe(
      true,
    );
  });

  it("rejects shared profile, community, platform, news and job-board hosts as strong identity evidence", () => {
    expect(classifySourceDomain("pf.kakao.com")).toMatchObject({
      class: "shared_profile",
      strongCompetitorIdentityEligible: false,
    });
    expect(classifySourceDomain("blog.naver.com")).toMatchObject({
      class: "community",
      strongCompetitorIdentityEligible: false,
    });
    expect(classifySourceDomain("oh-car.kr")).toMatchObject({
      class: "auto_platform",
      strongCompetitorIdentityEligible: false,
    });
    expect(classifySourceDomain("v.daum.net")).toMatchObject({
      class: "news",
      strongCompetitorIdentityEligible: false,
    });
    expect(classifySourceDomain("jobkorea.co.kr")).toMatchObject({
      class: "job_board",
      strongCompetitorIdentityEligible: false,
    });
  });

  it("rejects manufacturer/brand and marketplace/directory sources for competitor identity corroboration", () => {
    expect(classifySourceDomain("shop.tesla.com")).toMatchObject({
      class: "brand_or_manufacturer",
      strongCompetitorIdentityEligible: false,
    });
    expect(classifySourceDomain("xpelkorea.com")).toMatchObject({
      class: "brand_or_manufacturer",
      strongCompetitorIdentityEligible: false,
    });
    expect(classifySourceDomain("daangn.com")).toMatchObject({
      class: "marketplace_or_directory",
      strongCompetitorIdentityEligible: false,
    });
  });

  it("preserves infrastructure-host detection used by v2 reads", () => {
    expect(isInfrastructureSourceDomain("s3.amazonaws.com")).toBe(true);
    expect(
      isInfrastructureSourceDomain("bucket.s3.ap-northeast-2.amazonaws.com"),
    ).toBe(true);
    expect(isInfrastructureSourceDomain("storage.googleapis.com")).toBe(true);
    expect(isInfrastructureSourceDomain("example.com")).toBe(false);
  });
});
