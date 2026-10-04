import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const authSource = readFileSync(
  resolve(process.cwd(), "src/routes/auth.tsx"),
  "utf8",
);

const landingSource = readFileSync(
  resolve(process.cwd(), "src/routes/index.tsx"),
  "utf8",
);

const authedRouteSource = readFileSync(
  resolve(process.cwd(), "src/routes/_authenticated/route.tsx"),
  "utf8",
);

describe("customer auth access contract", () => {
  it("keeps self-service signup closed in the customer UI", () => {
    expect(authSource).toContain("const SELF_SIGNUP_ENABLED = false;");
    expect(authSource).toContain(
      "차보임 CHABOIM 로그인 화면입니다. 자동차 업체 AI 추천시장 분석 서비스.",
    );
  });

  it("lets users return home from the auth brand without adding another button", () => {
    expect(authSource).toContain('to="/"');
    expect(authSource).toContain('aria-label="차보임 홈으로 이동"');
    expect(authSource).toContain("hover:opacity-80");
  });

  it("keeps password recovery available even while signup is closed", () => {
    expect(authSource).toContain("resetPasswordForEmail");
    expect(authSource).toContain('/auth?mode=recovery');
    expect(authSource).toContain('event === "PASSWORD_RECOVERY"');
    expect(authSource).toContain('updateUser({ password: newPassword })');
    expect(authSource).toContain("비밀번호를 잊으셨나요?");
    expect(authSource).toContain(
      "가입된 계정이면 비밀번호 재설정 메일을 보내드립니다.",
    );
  });

  it("redirects authenticated users before rendering public entry screens", () => {
    expect(landingSource).toContain("beforeLoad: async () =>");
    expect(landingSource).toContain("supabase.auth.getUser()");
    expect(landingSource).toContain('redirect({ to: "/dashboard" })');

    expect(authSource).toContain("beforeLoad: async ({ search }) =>");
    expect(authSource).toContain("supabase.auth.getUser()");
    expect(authSource).toContain('redirect({ to: "/dashboard" })');
  });

  it("does not render onboarding while sign-out is in progress", () => {
    expect(authedRouteSource).toContain("const [isSigningOut, setIsSigningOut] = useState(false)");
    expect(authedRouteSource).toContain("setIsSigningOut(true)");
    expect(authedRouteSource).toContain("loading || isSigningOut");
    expect(authedRouteSource).toContain('isSigningOut ? "로그아웃 중…" : "불러오는 중…"');
    expect(authedRouteSource).toContain('disabled={isSigningOut}');
  });

  it("does not redirect an authenticated recovery session away from the reset form", () => {
    expect(authSource).toContain('search["mode"] === "recovery"');
    expect(authSource).toContain('if (search.mode === "recovery") return;');
    expect(authSource).toContain('event === "PASSWORD_RECOVERY"');
  });
});
