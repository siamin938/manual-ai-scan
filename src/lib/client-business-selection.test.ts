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

  // 공유 선택 상태(ActiveTargetBusinessProvider) 시나리오
  it("페이지(라우트)가 바뀌어도 같은 공유 선택이면 같은 업체 유지", () => {
    const shared = { orgId: "org1", businessId: "b" };
    const onQuestions = resolveSelectedBusinessId("org1", opts, shared);
    const onRuns = resolveSelectedBusinessId("org1", opts, shared);
    const onDashboard = resolveSelectedBusinessId("org1", opts, shared);
    expect([onQuestions, onRuns, onDashboard]).toEqual(["b", "b", "b"]);
  });

  it("org가 바뀌면 이전 org의 businessId는 무효화되고 새 org 목록에서 fallback", () => {
    const shared = { orgId: "org1", businessId: "b" };
    expect(resolveSelectedBusinessId("org2", [{ id: "x" }], shared)).toBe("x");
  });

  it("저장된 잘못된 id는 현재 목록과 대조 후 사용하지 않음", () => {
    expect(
      resolveSelectedBusinessId("org1", opts, { orgId: "org1", businessId: "deleted" }),
    ).not.toBe("deleted");
  });
});

