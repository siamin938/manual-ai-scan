import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const authSource = readFileSync(
  resolve(process.cwd(), "src/routes/auth.tsx"),
  "utf8",
);

describe("customer auth production UX contract", () => {
  it("keeps public self-signup closed", () => {
    expect(authSource).toContain("const SELF_SIGNUP_ENABLED = false;");
    expect(authSource).toContain('"이메일과 비밀번호로 로그인하세요."');
  });

  it("provides password recovery without reopening signup", () => {
    expect(authSource).toContain("resetPasswordForEmail");
    expect(authSource).toContain('redirectTo: `${window.location.origin}/auth?mode=recovery`');
    expect(authSource).toContain('event === "PASSWORD_RECOVERY"');
    expect(authSource).not.toContain("if (recoveryRedirect) setRecoveryMode(true)");
    expect(authSource).toContain("updateUser({ password: newPassword })");
    expect(authSource).toContain("비밀번호를 잊으셨나요?");
    expect(authSource).toContain("재설정 메일 보내기");
    expect(authSource).toContain("비밀번호 변경");
  });

  it("does not reveal whether an email is registered in the reset confirmation copy", () => {
    expect(authSource).toContain(
      "가입된 계정이면 비밀번호 재설정 메일을 보내드립니다.",
    );
  });
});
