import { describe, expect, it } from "vitest";
import { parseResponseStructure } from "../../supabase/functions/_shared/entity-engine-v2/response-structure";

describe("Entity Engine v2 response structure parser", () => {
  it("does not let a ranked section heading absorb evidence from table rows", () => {
    const text = [
      "## 1순위로 문의해볼 곳",
      "",
      "| 업체 | 위치 | 연락처 |",
      "|---|---|---|",
      "| **XPEL Pro 일산백석점** | 일산동구 장항로 70 나동 | **010-3125-0509** |",
    ].join("\n");

    const nodes = parseResponseStructure(text);
    const heading = nodes.find((node) => node.kind === "heading");
    const row = nodes.find(
      (node) =>
        node.kind === "table_row" &&
        node.cells?.[0] === "XPEL Pro 일산백석점",
    );

    expect(heading?.text).toBe("로 문의해볼 곳");
    expect(heading?.scopeText).not.toContain("010-3125-0509");
    expect(heading?.scopeText).not.toContain("장항로");

    expect(row?.scopeText).toContain("010-3125-0509");
    expect(row?.scopeText).toContain("장항로 70");
    expect(row?.parentId).toBe(heading?.id);
  });

  it("keeps comparison headings separate from business table rows", () => {
    const text = [
      "## 성남 엔진오일 정비소 비교",
      "",
      "| 정비소 | 위치 |",
      "|---|---|",
      "| **판교메젠모터스** | 분당구 금곡동 |",
      "| **트윈모터스** | 분당구 백현동 |",
    ].join("\n");

    const nodes = parseResponseStructure(text);
    const heading = nodes.find((node) => node.kind === "heading");
    const rows = nodes.filter((node) => node.kind === "table_row");

    expect(heading?.text).toBe("성남 엔진오일 정비소 비교");
    expect(rows.map((row) => row.cells?.[0])).toEqual([
      "정비소",
      "판교메젠모터스",
      "트윈모터스",
    ]);
    expect(rows.every((row) => row.parentId === heading?.id)).toBe(true);
  });

  it("splits criterion labels from the business-bearing body", () => {
    const text = [
      "### 목적별로 고르면",
      "- **운정·교하에서 최대한 가까운 곳:** 티스테이션 파주교하점, 금호타이어 운정신도시점",
      "- **금촌·조리 쪽:** 타이어프로 봉일천점",
      "- **문산 쪽에서 내려오는 경우:** 타이어프로 엘지로점",
    ].join("\n");

    const nodes = parseResponseStructure(text);
    const item = nodes.find(
      (node) => node.kind === "list_item" && node.criterionLabel === "금촌·조리 쪽",
    );

    expect(item?.criterionBody).toBe("타이어프로 봉일천점");
    expect(item?.text).toContain("금촌·조리 쪽");
    expect(item?.scopeText).toContain("타이어프로 봉일천점");
  });

  it("keeps purpose labels separate from an embedded registered business", () => {
    const text = [
      "## 목적별 추천",
      "- **가성비와 투명한 공임:** 공임나라 분당금곡점",
      "- **빠른 국산차 오일 교환:** 현대엑스티어 판교",
    ].join("\n");

    const nodes = parseResponseStructure(text);
    const item = nodes.find(
      (node) =>
        node.kind === "list_item" &&
        node.criterionLabel === "빠른 국산차 오일 교환",
    );

    expect(item?.criterionBody).toBe("현대엑스티어 판교");
    expect(item?.criterionLabel).not.toContain("현대엑스티어 판교");
  });

  it("parents an indented continuation paragraph to its list item only", () => {
    const text = [
      "- **판교메젠모터스**",
      "  분당구 대왕판교로 178, ☎ 031-717-1579",
      "- **트윈모터스**",
      "분당구 백현동 일반 안내 문단",
    ].join("\n");

    const nodes = parseResponseStructure(text);
    const firstItem = nodes.find(
      (node) => node.kind === "list_item" && node.text === "판교메젠모터스",
    );
    const firstDetail = nodes.find(
      (node) =>
        node.kind === "paragraph" &&
        node.text.includes("대왕판교로 178"),
    );
    const secondItem = nodes.find(
      (node) => node.kind === "list_item" && node.text === "트윈모터스",
    );
    const looseParagraph = nodes.find(
      (node) =>
        node.kind === "paragraph" &&
        node.text.includes("백현동 일반 안내"),
    );

    expect(firstDetail?.parentId).toBe(firstItem?.id);
    expect(firstDetail?.indent).toBeGreaterThan(firstItem?.indent ?? 0);
    expect(looseParagraph?.parentId).not.toBe(secondItem?.id);
  });

  it("preserves a real business heading as its own scope", () => {
    const text = [
      "### 3. 그린카서비스",
      "- **주소:** 경기도 성남시 분당구 정자동 242-1",
      "- **전화:** 031-712-6522",
    ].join("\n");

    const nodes = parseResponseStructure(text);
    const heading = nodes.find((node) => node.kind === "heading");
    const address = nodes.find(
      (node) => node.kind === "list_item" && node.criterionLabel === "주소",
    );

    expect(heading?.text).toBe("그린카서비스");
    expect(heading?.scopeText).not.toContain("031-712-6522");
    expect(address?.criterionBody).toBe("경기도 성남시 분당구 정자동 242-1");
    expect(address?.parentId).toBe(heading?.id);
  });
});
