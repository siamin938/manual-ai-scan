import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  classifyCustomMeasurement,
  summarizeCustomQuestions,
} from "../../src/lib/custom-diagnostic.helpers";

describe("custom diagnostic status", () => {
  it("classifies measurements", () => {
    expect(classifyCustomMeasurement({ valid: true, was_client_mentioned: true, client_position: 2 })).toBe("confirmed");
    expect(classifyCustomMeasurement({ valid: true, was_client_mentioned: true, client_position: null })).toBe("unresolved");
    expect(classifyCustomMeasurement({ valid: true, was_client_mentioned: false, client_position: null })).toBe("missing");
    expect(classifyCustomMeasurement({ valid: false, was_client_mentioned: true, client_position: 1 })).toBe("invalid");
  });

  it("summarizes 1 of 8 as 12.5%", () => {
    const qs = Array.from({ length: 8 }, (_, i) => ({
      questionId: String(i),
      promptText: "",
      intentType: "",
      status: i === 0 ? ("confirmed" as const) : ("missing" as const),
      position: i === 0 ? 2 : null,
    }));
    const s = summarizeCustomQuestions(qs);
    expect(s.validCount).toBe(8);
    expect(s.confirmedCount).toBe(1);
    expect(s.confirmedPct).toBe(12.5);
  });

  it("server DTO never selects raw response or provider fields", () => {
    const src = readFileSync(resolve(__dirname, "../../src/lib/custom-diagnostic.server.ts"), "utf8");
    expect(src).not.toMatch(/response_text|provider_model|actual_cost_usd/);
    expect(src).toContain('.eq("diagnostic_scope", "customer")');
  });

  it("dashboard shows custom main and standard baseline sections", () => {
    const src = readFileSync(resolve(__dirname, "../../src/routes/_authenticated/dashboard.tsx"), "utf8");
    for (const text of ["내 업체 맞춤 진단", "대표 진단", "기본 AI 노출 진단", "비교 기준", "직접 비교하지 않습니다"]) {
      expect(src).toContain(text);
    }
  });
});
