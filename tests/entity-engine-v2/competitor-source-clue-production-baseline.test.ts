import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

type BaselineRun = {
  runId: string;
  business: string;
  accepted: number;
  clueDomains: number;
  clueEntityLinks: number;
  newClueDomains: number;
  combined: number;
};

type Baseline = {
  version: string;
  summary: {
    runCount: number;
    acceptedObservedSourceDomainCount: number;
    competitorSourceClueRunCount: number;
    competitorSourceClueDomainCount: number;
    competitorSourceClueEntityLinkCount: number;
    newCompetitorSourceClueDomainCount: number;
    combinedObservedSourceDomainCount: number;
  };
  runs: BaselineRun[];
  kaspaceLatest: {
    runId: string;
    acceptedDomains: string[];
    newClueDomains: Array<{ domain: string; canonicalKey: string }>;
    combinedDomainCount: number;
  };
};

const baseline = JSON.parse(
  readFileSync(
    resolve(
      process.cwd(),
      "scripts/reports/competitor-source-clue-production-baseline-v01.json",
    ),
    "utf8",
  ),
) as Baseline;

describe("Competitor source clue Production 23-run baseline", () => {
  it("locks the reviewed cross-business totals", () => {
    expect(baseline.version).toBe(
      "competitor-source-clue-production-baseline-v0.1",
    );
    expect(baseline.summary).toEqual({
      runCount: 23,
      acceptedObservedSourceDomainCount: 94,
      competitorSourceClueRunCount: 13,
      competitorSourceClueDomainCount: 32,
      competitorSourceClueEntityLinkCount: 32,
      newCompetitorSourceClueDomainCount: 28,
      combinedObservedSourceDomainCount: 122,
    });
  });

  it("keeps every run internally consistent and does not invent clues for zero-evidence runs", () => {
    expect(baseline.runs).toHaveLength(23);

    for (const run of baseline.runs) {
      expect(run.combined).toBe(run.accepted + run.newClueDomains);
      expect(run.clueEntityLinks).toBeGreaterThanOrEqual(run.clueDomains);
      expect(run.newClueDomains).toBeLessThanOrEqual(run.clueDomains);

      if (run.accepted === 0 && run.clueDomains === 0) {
        expect(run.combined).toBe(0);
      }
    }

    expect(
      baseline.runs.filter((run) => run.clueDomains > 0),
    ).toHaveLength(13);
  });

  it("shows the rule generalizes beyond Carspace", () => {
    const withNewClues = new Set(
      baseline.runs
        .filter((run) => run.newClueDomains > 0)
        .map((run) => run.business),
    );

    expect(withNewClues).toEqual(
      expect.objectContaining
        ? withNewClues
        : withNewClues,
    );
    expect(withNewClues.has("카스페이스 구로점")).toBe(true);
    expect(withNewClues.has("오토트리")).toBe(true);
    expect(withNewClues.has("커스텀개러지")).toBe(true);
    expect(withNewClues.has("타이어프로 봉일천점")).toBe(true);
    expect(withNewClues.has("현대엑스티어 판교")).toBe(true);
    expect(withNewClues.has("액슬론 모터 스튜디오")).toBe(true);
  });

  it("locks the reviewed latest Carspace source expansion", () => {
    expect(baseline.kaspaceLatest).toEqual({
      runId: "28a793c9-c24d-41ff-9037-f08abc21b3ca",
      acceptedDomains: ["hunnytip.kr"],
      newClueDomains: [
        {
          domain: "silliskorea.com",
          canonicalKey: "auto:실리스코리아",
        },
        {
          domain: "pf.kakao.com",
          canonicalKey: "auto:제이존jzone",
        },
        {
          domain: "carcarescenter.com",
          canonicalKey: "auto:퀀텀팩토리서초점",
        },
        {
          domain: "motorcube.co.kr",
          canonicalKey: "auto:모터큐브",
        },
      ],
      combinedDomainCount: 5,
    });
  });

  it("keeps citation title in both historical replay exports", () => {
    for (const file of [
      "scripts/sql/export-entity-facts-phase2c-replay.sql",
      "scripts/sql/export-observed-sources-v2-backfill-replay.sql",
    ]) {
      const sql = readFileSync(resolve(process.cwd(), file), "utf8");
      expect(sql).toContain("'title', a.title");
    }
  });
});
