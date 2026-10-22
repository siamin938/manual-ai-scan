import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("CHABOIM Korean document language contract", () => {
  const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

  it("marks the Korean UI as Korean instead of English", () => {
    const root = read("src/routes/__root.tsx");
    expect(root).toContain('<html lang="ko">');
    expect(root).not.toContain('<html lang="en">');
    expect(root).toContain('{ charSet: "utf-8" }');
    expect(root).toContain('content: "width=device-width, initial-scale=1"');
  });

  it("preserves Korean app copy without machine translation or broad translation bans", () => {
    const root = read("src/routes/__root.tsx");
    const auth = read("src/routes/auth.tsx");
    const layout = read("src/routes/_authenticated/route.tsx");

    expect(root).toContain("차보임 CHABOIM");
    expect(auth).toContain('title: "로그인 · 차보임 CHABOIM"');
    expect(layout).toContain('label: "AI 노출 진단"');
    expect(layout).toContain('label: "측정 기록"');

    // Avoid a blanket translate="no" that unnecessarily blocks genuine
    // users who need to translate a Korean-language report themselves.
    expect(root).not.toContain('translate="no"');
    expect(root).not.toContain('content: "notranslate"');
  });
});
