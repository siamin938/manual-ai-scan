import { describe, expect, it } from "vitest";
import {
  selectSafeCitationPageForEntity,
  type CitationPageCandidate,
} from "../../src/lib/action-opportunity-citation-selection";

const direct = (url: string): CitationPageCandidate => ({
  url, attributionLevel: "direct",
});
const section = (url: string): CitationPageCandidate => ({
  url, attributionLevel: "section",
});

describe("safe exact-Run observed-business citation link selection", () => {
  it("does not associate 크로우랩 with a different business's cited profile", () => {
    // Production-shaped, generalized collision: two direct attributions are
    // attached to the same canonical business, but one URL names another shop.
    const competitorUrl =
      "https://www.daangn.com/kr/local-profile/" +
      encodeURIComponent("원투-랩핑-ppf-zb83cuz1ngim") + "/?utm_source=openai";
    const ownUrl =
      "https://www.daangn.com/kr/local-profile/" +
      encodeURIComponent("크로우랩-2mkkjfseawpn") + "/?utm_source=openai";
    const citations = [
      direct(competitorUrl),
      direct(ownUrl),
      section(ownUrl),
      section(ownUrl),
    ];
    expect(selectSafeCitationPageForEntity("크로우랩", citations)).toEqual(
      direct(ownUrl),
    );
    expect(selectSafeCitationPageForEntity("크로우랩", citations.slice().reverse())).toEqual(
      direct(ownUrl),
    );
  });

  it("keeps one unambiguous cited URL even when its path has no shop name", () => {
    const url = "https://carcarescenter.com/?utm_source=openai";
    expect(selectSafeCitationPageForEntity("퀀텀팩토리 서초점", [
      section(url), section(url), section(url),
    ])).toEqual(section(url));
  });

  it("does not guess when several URLs lack an identity clue", () => {
    expect(selectSafeCitationPageForEntity("크로우랩", [
      direct("https://example.com/page-a"),
      direct("https://example.com/page-b"),
    ])).toBeNull();
  });

  it("never chooses one of two other businesses' distinct URLs", () => {
    expect(selectSafeCitationPageForEntity("씽카스게러지 안산점", [
      direct("https://example.com/원투-랩핑-ppf"),
      section("https://example.com/크로우랩"),
    ])).toBeNull();
  });

  it("preserves source attribution level instead of upgrading section evidence", () => {
    const uri = "https://www.daangn.com/kr/local-profile/" +
      encodeURIComponent("원투-랩핑-ppf-zb83cuz1ngim") + "/";
    expect(selectSafeCitationPageForEntity("원투 랩핑 PPF", [section(uri)]))
      .toEqual(section(uri));
  });

  it("rejects unsafe URL protocols, including when only one candidate exists", () => {
    expect(selectSafeCitationPageForEntity("크로우랩", [direct("javascript:alert(1)")])).toBeNull();
    expect(selectSafeCitationPageForEntity("크로우랩", [direct("data:text/plain,hello")])).toBeNull();
  });

  it("does not require a hardcoded shop or domain allowlist", () => {
    const url = "https://any-domain.example/kr/local-profile/" +
      encodeURIComponent("새업체-이름") + "/";
    expect(selectSafeCitationPageForEntity("새업체 이름", [section(url)]))
      .toEqual(section(url));
  });
});
