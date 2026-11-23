/**
 * Resolve one displayed citation URL for one observed business, without
 * guessing between multiple, incompatible cited pages.
 *
 * Citation attribution is co-observation, not verified page ownership.
 * A name explicitly present in the decoded URL path is a disambiguation
 * clue only; never infer that the page is official or caused AI visibility.
 */
export type CitationPageCandidate = {
  url: string;
  attributionLevel: "direct" | "section";
};

type ScoredCitationPage = CitationPageCandidate & {
  observations: number;
  pathNamesEntity: boolean;
};

function normalizedSurface(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(/[^0-9a-z가-힣]/giu, "");
}

function decodedPathname(url: URL): string {
  try {
    return decodeURIComponent(url.pathname);
  } catch {
    return "";
  }
}

function priority(value: "direct" | "section"): number {
  return value === "direct" ? 0 : 1;
}

export function selectSafeCitationPageForEntity(
  entityName: string,
  candidates: readonly CitationPageCandidate[],
): CitationPageCandidate | null {
  const identity = normalizedSurface(entityName.trim());
  if (!identity) return null;

  const byUrl = new Map<string, ScoredCitationPage>();
  for (const candidate of candidates) {
    let parsed: URL;
    try {
      parsed = new URL(candidate.url);
    } catch {
      continue;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") continue;

    const url = parsed.toString();
    const pathSurface = normalizedSurface(decodedPathname(parsed));
    // An exact name appearing inside a URL slug can break ambiguity.
    // Short labels do not have enough distinctive characters for this test.
    const pathNamesEntity =
      identity.length >= 3 && pathSurface.includes(identity);
    const previous = byUrl.get(url);

    if (previous) {
      previous.observations += 1;
      previous.pathNamesEntity ||= pathNamesEntity;
      if (priority(candidate.attributionLevel) < priority(previous.attributionLevel)) {
        previous.attributionLevel = candidate.attributionLevel;
      }
    } else {
      byUrl.set(url, {
        url,
        attributionLevel: candidate.attributionLevel,
        observations: 1,
        pathNamesEntity,
      });
    }
  }

  const pages = [...byUrl.values()];
  if (pages.length === 0) return null;

  // One distinct citation URL is not an ambiguous URL choice, although
  // attribution alone still does not verify the page's ownership.
  if (pages.length === 1) {
    return { url: pages[0]!.url, attributionLevel: pages[0]!.attributionLevel };
  }

  // Multiple different URLs for the same business need an explicit
  // identity clue. Never pick an arbitrary first direct attribution.
  const supported = pages.filter((page) => page.pathNamesEntity);
  if (supported.length === 0) return null;

  supported.sort(
    (a, b) =>
      priority(a.attributionLevel) - priority(b.attributionLevel) ||
      b.observations - a.observations ||
      a.url.localeCompare(b.url, "en"),
  );
  return {
    url: supported[0]!.url,
    attributionLevel: supported[0]!.attributionLevel,
  };
}
