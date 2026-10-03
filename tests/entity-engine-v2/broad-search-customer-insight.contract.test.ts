import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const dashboardSource = readFileSync(
  resolve(process.cwd(), "src/routes/_authenticated/dashboard.tsx"),
  "utf8",
);

const gatewaySource = readFileSync(
  resolve(process.cwd(), "src/lib/entity-facts-v2-read-gateway.server.ts"),
  "utf8",
);

describe("broad search customer insight contract", () => {
  it("shows repeated, one-time and source-pattern broad-search evidence", () => {
    expect(dashboardSource).toContain("기준 검색에서 반복 관찰된 업체");
    expect(dashboardSource).toContain("2회 이상 확인된");
    expect(dashboardSource).toContain("함께 확인된 독립 웹 출처");
    expect(dashboardSource).toContain("기준 검색에서 추가로 한 번 확인된 업체");
    expect(dashboardSource).toContain("이번 기준 검색에서 확인된 공개 근거 패턴");
    expect(dashboardSource).toContain(
      "공식 홈페이지는 등록돼 있지만, 이번 기준 검색 답변에서는 내 업체와 독립 웹",
    );
    expect(dashboardSource).toContain(
      "특정 출처나 정보가 AI\n              노출을 발생시켰다는 인과관계를 의미하지 않습니다.",
    );
  });

  it("keeps the broad-search supplement read-only and separate from target truth", () => {
    expect(gatewaySource).toContain("fetchBroadSearchObservation");
    expect(gatewaySource).toContain(
      "never\n  // changes targetSeen, Top3, aggregate truth, or measurement storage",
    );
    expect(gatewaySource).not.toContain(
      "gatewayResponse.data.overview = broadSearchObservation",
    );
  });
});
