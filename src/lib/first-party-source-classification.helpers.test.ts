import { describe, expect, it } from "vitest";
import {
  FIRST_PARTY_CLASSIFIER_VERSION,
  buildClassificationRow,
  buildClassificationRows,
  mergeSummaries,
  summarizeClassificationRows,
  toRegistryEntries,
  type FirstPartySourceRow,
} from "./first-party-source-classification.helpers";

const ORG = "11111111-1111-4111-8111-111111111111";
const BIZ = "22222222-2222-4222-8222-222222222222";

const registryRows: FirstPartySourceRow[] = [
  {
    id: "reg-owned",
    source_type: "owned_domain",
    canonical_url: null,
    normalized_host: "example.com",
    resource_key: null,
    match_mode: "host_or_subdomain",
    verification_status: "verified",
    active: true,
  },
  {
    id: "reg-blog",
    source_type: "naver_blog",
    canonical_url: null,
    normalized_host: null,
    resource_key: "officialaccount",
    match_mode: "resource_prefix",
    verification_status: "verified",
    active: true,
  },
  {
    id: "reg-inactive",
    source_type: "owned_domain",
    canonical_url: null,
    normalized_host: "inactive.com",
    resource_key: null,
    match_mode: "host_or_subdomain",
    verification_status: "verified",
    active: false,
  },
  {
    id: "reg-pending",
    source_type: "owned_domain",
    canonical_url: null,
    normalized_host: "pending.com",
    resource_key: null,
    match_mode: "host_or_subdomain",
    verification_status: "pending",
    active: true,
  },
  {
    id: "reg-unknown-type",
    source_type: "instagram",
    canonical_url: null,
    normalized_host: "instagram.com",
    resource_key: null,
    match_mode: "host_or_subdomain",
    verification_status: "verified",
    active: true,
  },
];

describe("toRegistryEntries", () => {
  it("keeps only active, verified and known-typed entries", () => {
    const entries = toRegistryEntries(registryRows);
    expect(entries.map((e) => e.id)).toEqual(["reg-owned", "reg-blog"]);
    expect(entries[0]?.normalizedHost).toBe("example.com");
    expect(entries[1]?.resourceKey).toBe("officialaccount");
  });
});

describe("buildClassificationRow", () => {
  it("maps a third_party result with null match_method", () => {
    const row = buildClassificationRow({
      orgId: ORG,
      businessId: BIZ,
      measurementSourceId: "src-1",
      result: {
        classification: "third_party",
        matchedFirstPartySourceId: null,
        sourceType: null,
        matchMethod: "none",
        confidence: "high",
      },
    });
    expect(row).toEqual({
      org_id: ORG,
      business_id: BIZ,
      measurement_source_id: "src-1",
      classification: "third_party",
      matched_first_party_source_id: null,
      source_type: null,
      match_method: null,
      confidence: "high",
      classifier_version: "0.1.0",
    });
  });
});

describe("buildClassificationRows", () => {
  const registry = toRegistryEntries(registryRows);

  it("classifies sources and skips already classified ids", () => {
    const { rows, skippedCount } = buildClassificationRows({
      orgId: ORG,
      businessId: BIZ,
      sources: [
        { id: "s1", url: "https://shop.example.com/a", domain: "shop.example.com" },
        { id: "s2", url: "https://blog.naver.com/officialaccount/1" },
        { id: "s3", url: "https://blog.naver.com/other/1" },
        { id: "s4", url: "not-a-url" },
        { id: "s5", url: "https://example.com" },
      ],
      registry,
      alreadyClassifiedSourceIds: new Set(["s5"]),
    });

    expect(skippedCount).toBe(1);
    expect(rows.map((r) => r.measurement_source_id)).toEqual(["s1", "s2", "s3", "s4"]);
    expect(rows[0]?.classification).toBe("first_party");
    expect(rows[0]?.matched_first_party_source_id).toBe("reg-owned");
    expect(rows[1]?.source_type).toBe("naver_blog");
    expect(rows[2]?.classification).toBe("third_party");
    expect(rows[3]).toMatchObject({ classification: "third_party", confidence: "low" });
    expect(rows.every((r) => r.classifier_version === "0.1.0")).toBe(true);
  });

  it("deduplicates repeated source ids within a batch", () => {
    const { rows, skippedCount } = buildClassificationRows({
      orgId: ORG,
      businessId: BIZ,
      sources: [
        { id: "dup", url: "https://example.com" },
        { id: "dup", url: "https://example.com" },
      ],
      registry,
      alreadyClassifiedSourceIds: new Set(),
    });
    expect(rows).toHaveLength(1);
    expect(skippedCount).toBe(1);
  });

  it("classifies everything third_party when the registry is empty", () => {
    const { rows } = buildClassificationRows({
      orgId: ORG,
      businessId: BIZ,
      sources: [{ id: "s1", url: "https://example.com" }],
      registry: [],
      alreadyClassifiedSourceIds: new Set(),
    });
    expect(rows[0]?.classification).toBe("third_party");
  });
});

describe("summaries", () => {
  it("aggregates counts without leaking ids or urls", () => {
    const registry = toRegistryEntries(registryRows);
    const { rows, skippedCount } = buildClassificationRows({
      orgId: ORG,
      businessId: BIZ,
      sources: [
        { id: "s1", url: "https://example.com" },
        { id: "s2", url: "https://third.com" },
        { id: "s3", url: "javascript:void(0)" },
        { id: "s4", url: "https://example.com/x" },
      ],
      registry,
      alreadyClassifiedSourceIds: new Set(["s4"]),
    });

    const summary = summarizeClassificationRows({
      sourceCount: 4,
      skippedCount,
      insertedRows: rows,
    });

    expect(summary).toEqual({
      classifierVersion: FIRST_PARTY_CLASSIFIER_VERSION,
      sourceCount: 4,
      insertedCount: 3,
      skippedCount: 1,
      firstPartyCount: 1,
      thirdPartyCount: 2,
      lowConfidenceCount: 1,
    });
    expect(Object.keys(summary).sort()).toEqual([
      "classifierVersion",
      "firstPartyCount",
      "insertedCount",
      "lowConfidenceCount",
      "skippedCount",
      "sourceCount",
      "thirdPartyCount",
    ]);
  });

  it("merges per-batch summaries", () => {
    const base = {
      classifierVersion: FIRST_PARTY_CLASSIFIER_VERSION,
      sourceCount: 2,
      insertedCount: 1,
      skippedCount: 1,
      firstPartyCount: 1,
      thirdPartyCount: 0,
      lowConfidenceCount: 0,
    };
    expect(mergeSummaries([base, base])).toEqual({
      classifierVersion: FIRST_PARTY_CLASSIFIER_VERSION,
      sourceCount: 4,
      insertedCount: 2,
      skippedCount: 2,
      firstPartyCount: 2,
      thirdPartyCount: 0,
      lowConfidenceCount: 0,
    });
    expect(mergeSummaries([]).sourceCount).toBe(0);
  });
});
