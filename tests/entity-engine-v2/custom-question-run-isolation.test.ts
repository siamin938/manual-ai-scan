import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CUSTOMER_STANDARD_QUESTION_COUNT } from "../../src/lib/customer-measurement.helpers";

describe("custom question run isolation", () => {
  it("keeps the main diagnostic contract at 24 questions", () => {
    expect(CUSTOMER_STANDARD_QUESTION_COUNT).toBe(24);
  });

  it("filters the main v2 read gateway to standard customer runs", () => {
    const source = readFileSync(
      new URL("../../src/lib/entity-facts-v2-read-gateway.server.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain(
      '.eq("total_jobs", CUSTOMER_STANDARD_QUESTION_COUNT)',
    );
  });

  it("filters current and prior comparison runs to the same standard contract", () => {
    const source = readFileSync(
      new URL("../../src/lib/entity-facts-v2-comparison.server.ts", import.meta.url),
      "utf8",
    );
    const matches = source.match(
      /\.eq\("total_jobs", CUSTOMER_STANDARD_QUESTION_COUNT\)/g,
    );
    expect(matches?.length).toBeGreaterThanOrEqual(2);
  });
});
