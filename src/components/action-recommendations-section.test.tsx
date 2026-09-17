import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
const state = vi.hoisted(() => ({ data: {} as Record<string, unknown> }));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: state.data, isLoading: false, isError: false, isFetching: false, refetch: vi.fn() }) }));
vi.mock("@tanstack/react-start", () => ({ useServerFn: () => vi.fn() }));
vi.mock("@/lib/visibility-actions.functions", () => ({ getActionRecommendations: vi.fn() }));
import { ActionRecommendationsSection } from "./action-recommendations-section";
describe("action evidence availability display", () => {
  beforeEach(() => {
    state.data = { ok: true, data: { recommendations: [], scope: null, disclaimer: "",
      comparison: { compatibleRunCount: 0, status: "unverified" }, availability: "complete", unavailableSections: [] } };
  });
  const render = () => renderToStaticMarkup(<ActionRecommendationsSection orgId="org" businessId="business" />);
  it("does not call an unverified history the first measurement", () => {
    const html = render();
    expect(html).toContain("이전 측정과 동일 조건인지 확인할 수 없어");
    expect(html).not.toContain("첫 측정");
  });
  it("shows a retry and never claims missing evidence after a partial failure", () => {
    state.data["data"] = { ...(state.data["data"] as object), availability: "partial", unavailableSections: ["업체 프로필"] };
    const html = render();
    expect(html).toContain("업체 프로필 정보를 불러오지 못했습니다");
    expect(html).toContain("다시 불러오기");
    expect(html).not.toContain("뚜렷한");
  });
});
