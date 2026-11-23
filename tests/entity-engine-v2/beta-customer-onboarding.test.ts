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
const authedRouteSource = readFileSync(
  resolve(process.cwd(), "src/routes/_authenticated/route.tsx"),
  "utf8",
);
const organizationPrivilegeMigration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260929094249_lock_customer_organization_system_columns_v01.sql",
  ),
  "utf8",
);

describe("beta customer onboarding contract", () => {
  it("keeps public self-signup closed in the customer auth surface", () => {
    expect(authSource).toContain("const SELF_SIGNUP_ENABLED = false;");
    expect(authSource).toContain('"이메일과 비밀번호로 로그인하세요."');
    expect(authSource).toContain("비밀번호를 잊으셨나요?");
  });

  it("scopes internal admin navigation access to the current signed-in user", () => {
    expect(authedRouteSource).toContain(
      'queryKey: ["can-view-data-asset-admin", sessionUserId]',
    );
    expect(authedRouteSource).toContain("enabled: !!sessionUserId");
    expect(authedRouteSource).toContain("staleTime: 0");
    expect(authedRouteSource).not.toContain(
      'queryKey: ["can-view-data-asset-admin"],',
    );
  });

  it("keeps customer organization system columns non-writable from authenticated clients", () => {
    expect(organizationPrivilegeMigration).toContain(
      "revoke insert, update, truncate, trigger, references",
    );
    expect(organizationPrivilegeMigration).toContain(
      "on table public.organizations",
    );
    expect(organizationPrivilegeMigration).toContain("from authenticated");
    expect(organizationPrivilegeMigration).toContain(
      "grant update (name, timezone)",
    );
    for (const systemColumn of [
      "measurement_data_origin",
      "daily_request_limit",
      "monthly_budget_usd",
      "plan",
      "slug",
    ]) {
      expect(organizationPrivilegeMigration).not.toContain(
        `grant update (${systemColumn}`,
      );
    }
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

  it("uses the shared IME-safe form path without leaving the submit button stuck disabled", () => {
    expect(onboardingSource).toContain("useImeSafeForm");
    expect(onboardingSource).toContain("formRef");
    expect(onboardingSource).toContain("compositionProps");
    expect(onboardingSource).toContain('e.key === "Enter" && isComposing(e)');
    expect(onboardingSource).not.toContain("busy ||\n                isComposing() ||");
  });
});
