import { describe, expect, it } from "vitest";
import { resolveSelectedBusinessId } from "./client-business-selection";

const opts = [{ id: "a" }, { id: "b" }];

describe("resolveSelectedBusinessId", () => {
  it("org가 없으면 null", () => {
    expect(resolveSelectedBusinessId(null, opts, null)).toBeNull();
  });

  it("선택이 없으면 첫 업체", () => {
    expect(resolveSelectedBusinessId("org1", opts, null)).toBe("a");
  });

  it("옵션이 비면 null", () => {
    expect(resolveSelectedBusinessId("org1", [], null)).toBeNull();
  });

  it("같은 org의 유효한 선택은 유지", () => {
    expect(resolveSelectedBusinessId("org1", opts, { orgId: "org1", businessId: "b" })).toBe("b");
  });

  it("다른 org의 선택은 무시하고 첫 업체", () => {
    expect(resolveSelectedBusinessId("org1", opts, { orgId: "org2", businessId: "b" })).toBe("a");
  });

  it("옵션에 없는 businessId는 무시", () => {
    expect(resolveSelectedBusinessId("org1", opts, { orgId: "org1", businessId: "zzz" })).toBe("a");
  });
});
