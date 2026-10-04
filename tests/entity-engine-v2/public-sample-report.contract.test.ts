import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sampleSource = readFileSync(
  resolve(process.cwd(), "src/routes/sample-report.tsx"),
  "utf8",
);

const landingSource = readFileSync(
  resolve(process.cwd(), "src/routes/index.tsx"),
  "utf8",
);

describe("public sample report productization", () => {
  it("exposes the sample from the public landing page", () => {
    expect(landingSource).toContain('to="/sample-report"');
    expect(landingSource).toContain("샘플 진단 결과 보기");
  });

  it("labels all public example data as sample rather than a customer result", () => {
    expect(sampleSource).toContain("샘플 데이터 · 실제 고객 결과 아님");
    expect(sampleSource).toContain("실제 고객 측정 결과가 아닙니다");
    expect(sampleSource).toContain("샘플 오토케어");
    expect(sampleSource).toContain("비교 업체 A");
    expect(sampleSource).toContain("독립 웹 출처 A");
  });

  it("shows the diagnostic story without changing measurement logic", () => {
    expect(sampleSource).toContain("24번 물어봤더니");
    expect(sampleSource).toContain("기준 검색 노출");
    expect(sampleSource).toContain("상세 검색 14/16");
    expect(sampleSource).toContain("기준 검색 0/8");
    expect(sampleSource).toContain("확인된 출처 연결 차이");
    expect(sampleSource).toContain("재측정하면 무엇이 달라지나요?");
    expect(sampleSource).toContain(
      "특정 출처가 AI 노출의 원인임을 의미하지 않습니다.",
    );
  });
});
