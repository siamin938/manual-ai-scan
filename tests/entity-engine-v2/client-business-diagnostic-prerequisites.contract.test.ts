import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const businessesSource = readFileSync(
  resolve(process.cwd(), "src/routes/_authenticated/businesses.tsx"),
  "utf8",
);

describe("client business diagnostic prerequisites", () => {
  it("requires both broad and detailed region before saving", () => {
    expect(businessesSource).toContain(
      'toast.error("지역(시/도)과 도시(시/군/구)를 모두 입력해 주세요.")',
    );
    expect(businessesSource).toContain('id="b-region"');
    expect(businessesSource).toContain('name="region"');
    expect(businessesSource).toContain('id="b-city"');
    expect(businessesSource).toContain('name="city"');
    expect(businessesSource).toContain("!form.region.trim()");
    expect(businessesSource).toContain("!form.city.trim()");
  });
});
