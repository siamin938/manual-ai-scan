import { describe, expect, it } from "vitest";
import {
  canonicalizeUrl,
  classifyFirstPartySource,
  type FirstPartySourceRegistryEntry,
} from "./first-party-source-classifier";

const owned: FirstPartySourceRegistryEntry = {
  id: "owned-1",
  sourceType: "owned_domain",
  normalizedHost: "example.com",
  matchMode: "host_or_subdomain",
  verificationStatus: "verified",
  active: true,
};

const naverPlace: FirstPartySourceRegistryEntry = {
  id: "place-1",
  sourceType: "naver_place",
  canonicalUrl: "https://naver.me/xSBsENP8",
  matchMode: "exact_url",
  verificationStatus: "verified",
  active: true,
};

const naverPlacePrefix: FirstPartySourceRegistryEntry = {
  id: "place-2",
  sourceType: "naver_place",
  canonicalUrl: "https://map.naver.com/p/entry/place/123456",
  matchMode: "resource_prefix",
  verificationStatus: "verified",
  active: true,
};

const naverBlog: FirstPartySourceRegistryEntry = {
  id: "blog-1",
  sourceType: "naver_blog",
  resourceKey: "officialaccount",
  matchMode: "resource_prefix",
  verificationStatus: "verified",
  active: true,
};

const registry = [owned, naverPlace, naverPlacePrefix, naverBlog];

describe("canonicalizeUrl", () => {
  it("strips hash, www, default port and trailing slash", () => {
    const c = canonicalizeUrl("HTTPS://WWW.Example.com:443/path/#frag");
    expect(c?.href).toBe("https://example.com/path");
  });

  it("removes tracking params but keeps others", () => {
    const c = canonicalizeUrl("https://example.com/a?utm_source=x&gclid=1&id=7");
    expect(c?.href).toBe("https://example.com/a?id=7");
  });

  it("returns null for non-http protocols", () => {
    expect(canonicalizeUrl("ftp://example.com")).toBeNull();
    expect(canonicalizeUrl("not a url")).toBeNull();
  });
});

describe("owned_domain host_or_subdomain", () => {
  it("matches exact host", () => {
    const r = classifyFirstPartySource({ url: "https://example.com/page" }, registry);
    expect(r.classification).toBe("first_party");
    expect(r.matchedFirstPartySourceId).toBe("owned-1");
    expect(r.matchMethod).toBe("host_or_subdomain");
    expect(r.confidence).toBe("high");
  });

  it("matches www host", () => {
    expect(classifyFirstPartySource({ url: "https://www.example.com/" }, registry).classification).toBe(
      "first_party",
    );
  });

  it("matches subdomain", () => {
    expect(classifyFirstPartySource({ url: "https://shop.example.com/x" }, registry).classification).toBe(
      "first_party",
    );
  });

  it("does not match lookalike domain", () => {
    const r = classifyFirstPartySource({ url: "https://evil-example.com/x" }, registry);
    expect(r).toEqual({
      classification: "third_party",
      matchedFirstPartySourceId: null,
      sourceType: null,
      matchMethod: "none",
      confidence: "high",
    });
  });
});

describe("naver_place exact_url", () => {
  it("matches the exact short url", () => {
    const r = classifyFirstPartySource({ url: "https://naver.me/xSBsENP8" }, registry);
    expect(r.matchedFirstPartySourceId).toBe("place-1");
    expect(r.matchMethod).toBe("exact_url");
  });

  it("matches with tracking query appended", () => {
    const r = classifyFirstPartySource(
      { url: "https://naver.me/xSBsENP8?utm_source=ai&fbclid=abc" },
      registry,
    );
    expect(r.classification).toBe("first_party");
  });

  it("does not match a different naver.me path", () => {
    const r = classifyFirstPartySource({ url: "https://naver.me/OTHER" }, registry);
    expect(r.classification).toBe("third_party");
  });
});

describe("naver_place resource_prefix", () => {
  it("matches the same path and sub paths", () => {
    expect(
      classifyFirstPartySource({ url: "https://map.naver.com/p/entry/place/123456" }, registry)
        .matchedFirstPartySourceId,
    ).toBe("place-2");
    expect(
      classifyFirstPartySource(
        { url: "https://map.naver.com/p/entry/place/123456/review?utm_medium=x" },
        registry,
      ).classification,
    ).toBe("first_party");
  });

  it("does not match a different place id", () => {
    expect(
      classifyFirstPartySource({ url: "https://map.naver.com/p/entry/place/999" }, registry)
        .classification,
    ).toBe("third_party");
  });
});

describe("naver_blog resource_prefix", () => {
  it("matches the official account path", () => {
    const r = classifyFirstPartySource({ url: "https://blog.naver.com/officialaccount/2231" }, registry);
    expect(r.matchedFirstPartySourceId).toBe("blog-1");
    expect(r.sourceType).toBe("naver_blog");
  });

  it("matches the mobile blog host", () => {
    expect(
      classifyFirstPartySource({ url: "https://m.blog.naver.com/officialaccount" }, registry)
        .classification,
    ).toBe("first_party");
  });

  it("does not match another account", () => {
    expect(
      classifyFirstPartySource({ url: "https://blog.naver.com/someoneelse/1" }, registry).classification,
    ).toBe("third_party");
  });

  it("does not match blog.naver.com root", () => {
    expect(classifyFirstPartySource({ url: "https://blog.naver.com/" }, registry).classification).toBe(
      "third_party",
    );
  });
});

describe("registry hygiene", () => {
  it("ignores inactive, pending and rejected entries", () => {
    const entries: FirstPartySourceRegistryEntry[] = [
      { ...owned, id: "a", active: false },
      { ...owned, id: "b", verificationStatus: "pending" },
      { ...owned, id: "c", verificationStatus: "rejected" },
    ];
    expect(classifyFirstPartySource({ url: "https://example.com" }, entries).classification).toBe(
      "third_party",
    );
  });

  it("prefers exact_url over resource_prefix over host_or_subdomain", () => {
    const entries: FirstPartySourceRegistryEntry[] = [
      { ...owned, id: "host", normalizedHost: "map.naver.com" },
      naverPlacePrefix,
      {
        ...naverPlace,
        id: "exact",
        canonicalUrl: "https://map.naver.com/p/entry/place/123456",
      },
    ];
    const r = classifyFirstPartySource({ url: "https://map.naver.com/p/entry/place/123456" }, entries);
    expect(r.matchedFirstPartySourceId).toBe("exact");

    const r2 = classifyFirstPartySource(
      { url: "https://map.naver.com/p/entry/place/123456/photo" },
      entries,
    );
    expect(r2.matchedFirstPartySourceId).toBe("place-2");
  });

  it("keeps the first entry when priority ties", () => {
    const entries: FirstPartySourceRegistryEntry[] = [
      { ...owned, id: "first" },
      { ...owned, id: "second" },
    ];
    expect(classifyFirstPartySource({ url: "https://example.com" }, entries).matchedFirstPartySourceId).toBe(
      "first",
    );
  });
});

describe("invalid input", () => {
  it("returns deterministic low-confidence third_party without throwing", () => {
    for (const url of ["", "javascript:alert(1)", "mailto:a@b.com", "://broken"]) {
      const r = classifyFirstPartySource({ url }, registry);
      expect(r).toEqual({
        classification: "third_party",
        matchedFirstPartySourceId: null,
        sourceType: null,
        matchMethod: "none",
        confidence: "low",
      });
    }
  });
});
