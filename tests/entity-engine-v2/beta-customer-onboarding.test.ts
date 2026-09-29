import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const authSource = readFileSync(
  resolve(process.cwd(), "src/routes/auth.tsx"),
  "utf8",
);
const onboardingSource = readFileSync(
  resolve(process.cwd(), "src/components/OrgOnboarding.tsx"),
  "utf8",
);
const questionsSource = readFileSync(
  resolve(process.cwd(), "src/routes/_authenticated/questions.tsx"),
  "utf8",
);

describe("beta customer onboarding contract", () => {
  it("allows beta self-signup only through the explicit auth surface", () => {
    expect(authSource).toContain("const SELF_SIGNUP_ENABLED = true;");
    expect(authSource).toContain("supabase.auth.signUp({");
    expect(authSource).toContain('TabsTrigger value="signup"');
    expect(authSource).toContain("onSubmit={signUp}");
    expect(authSource).toContain("가입 후 이메일 인증이 완료되어야 로그인할 수 있습니다.");
    expect(authSource).toContain("회원가입이 완료되었습니다. 이메일 인증 후 로그인해 주세요.");
  });

  it("creates organizations through the JWT-protected Edge path instead of a browser RPC", () => {
    expect(onboardingSource).toContain(
      'supabase.functions.invoke("create-organization-with-owner"',
    );
    expect(onboardingSource).not.toContain(
      'rpc("create_organization_with_owner_server_v01"',
    );
  });

  it("collects and stores the region fields required by unified question generation", () => {
    expect(onboardingSource).toContain('name="region"');
    expect(onboardingSource).toContain('name="city"');
    expect(onboardingSource).toContain("region: latestRegion");
    expect(onboardingSource).toContain("city: latestCity");
    expect(onboardingSource).toContain("!latestRegion || !latestCity");
    expect(questionsSource).toContain(
      "등록된 지역 정보가 없어 맞춤 질문을 만들 수 없습니다.",
    );
  });

  it("keeps first-run categories aligned with the customer business registration surface", () => {
    for (const category of [
      "자동차 튜닝",
      "자동차 정비/엔진오일",
      "자동차 디테일링/세차",
      "썬팅/신차패키지",
      "PPF/랩핑",
      "자동차 용품/전장",
      "타이어/휠",
      "렌터카/자동차 서비스",
      "기타 자동차 서비스",
    ]) {
      expect(onboardingSource).toContain(`"${category}"`);
    }
    expect(onboardingSource).not.toContain('"자동차 정비",');
  });

  it("uses the shared IME-safe form path for Korean onboarding fields", () => {
    expect(onboardingSource).toContain("useImeSafeForm");
    expect(onboardingSource).toContain("formRef");
    expect(onboardingSource).toContain("compositionProps");
    expect(onboardingSource).toContain("isComposing()");
  });
});
