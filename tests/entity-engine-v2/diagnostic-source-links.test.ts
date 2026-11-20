import { describe, expect, it } from "vitest";
import { repeatedPeerEvidence, savedSourceUrl, scopedCitedPages } from "../../src/lib/diagnostic-source-links";
import type { EntityFactsV2ReadOverviewDTO } from "../../src/lib/entity-facts-v2-read-gateway.types";

describe("scope and identity of diagnostic source links", () => {
  const page = { title: "테스트 정비 | 서울 | 당근 동네 업체", url: "https://www.daangn.com/kr/local-profile/test-123/?utm_source=one", domain: "daangn.com", measurement_id: "b1" };
  it("counts distinct valid broad answers and separates citations from names in the answer body", () => {
    const rows = [page, page, { ...page, measurement_id: "b2", url: page.url + "&q=test" }, { ...page, measurement_id: "local" }];
    const answers = new Map([["b1", "**테스트 정비** — 서울"],["b2", "[테스트 정비](https://example.com/page)"]]);
    expect(scopedCitedPages(rows, new Set(["b1","b2"]), answers)).toEqual([
      expect.objectContaining({ profileName: "테스트 정비", responseCount: 2, namedResponseCount: 1, url: page.url }),
    ]);
  });
  it("keeps separate resources on sites that identify pages by query", () => {
    const base = { ...page, domain: "example.com" };
    expect(scopedCitedPages([{...base,url:"https://example.com/?id=1"},{...base,url:"https://example.com/?id=2"}],new Set(["b1"]))).toHaveLength(2);
  });
  it.each(["https://daangn.com.example.com/p", "javascript:alert(1)", "https://user@daangn.com/p", "daangn.com", "https://example.com/"])("rejects unsupported or mismatched destinations", url => {
    expect(savedSourceUrl(url, "daangn.com")).toBeNull();
  });
  it("does not attach another business's page, an unconfirmed clue or the domain-wide count to a peer", () => {
    const counts = { questionCount: 2, intentCount: 2, top3ResponseCount: 1 };
    const dto = {
      overview: { validCount: 4 } as EntityFactsV2ReadOverviewDTO,
      competitors: [{...counts,name:"A",responseCount:2},{...counts,name:"B",responseCount:1}],
      observedSources: [{domain:"example.com",responseCount:4,targetResponseCount:2,competitorResponseCount:2,clueResponseCount:1,evidence:"mixed" as const,linkedEntities:[
        {name:"A",isTarget:false,responseCount:1,evidence:"confirmed" as const},{name:"B",isTarget:false,responseCount:1,evidence:"clue" as const},
      ]}],
    };
    const refs = [{domain:"example.com",sourceGroupKey:"other",entityCount:1,responseCount:2,entities:[{entityName:"B",url:"https://example.com/b",attributionLevel:"section" as const}]}];
    expect(repeatedPeerEvidence(dto,refs)).toEqual([{...dto.competitors[0],sources:[{domain:"example.com",count:1,url:undefined}]}]);
  });
});
