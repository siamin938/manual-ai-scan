import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const authSource = readFileSync(
  resolve(process.cwd(), "src/routes/auth.tsx"),
  "utf8",
);

describe("customer auth access contract", () => {
  it("keeps self-service signup closed in the customer UI", () => {
    expect(authSource).toContain("const SELF_SIGNUP_ENABLED = false;");
    expect(authSource).toContain(
      "차보임 CHABOIM 로그인 화면입니다. 자동차 업체 AI 추천시장 분석 서비스.",
    );
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

  it("does not redirect an authenticated recovery session away from the reset form", () => {
    expect(authSource).toContain(
      'new URLSearchParams(window.location.search).get("mode") === "recovery"',
    );
    expect(authSource).toContain("if (!recoveryRedirect)");
  });
});
