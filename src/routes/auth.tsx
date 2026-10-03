import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";

const SELF_SIGNUP_ENABLED = false;

export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "로그인 · 차보임 CHABOIM" },
      { name: "description", content: "차보임 CHABOIM 로그인 화면입니다. 자동차 업체 AI 추천시장 분석 서비스." },
      { property: "og:title", content: "로그인 · 차보임 CHABOIM" },
      { property: "og:description", content: "자동차 업체 AI 추천시장 분석 서비스 로그인" },

    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [authTab, setAuthTab] = useState<"signin" | "signup">("signin");
  const [resetRequestMode, setResetRequestMode] = useState(false);
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [newPasswordConfirm, setNewPasswordConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const recoveryRedirect =
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("mode") === "recovery";

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setRecoveryMode(true);
    });

    if (!recoveryRedirect) {
      supabase.auth.getSession().then(({ data }) => {
        if (data.session) navigate({ to: "/dashboard" });
      });
    }

    return () => subscription.unsubscribe();
  }, [navigate]);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) {
      toast.error(`로그인 실패: ${error.message}`);
      return;
    }
    navigate({ to: "/dashboard" });
  }


  async function requestPasswordReset(e: React.FormEvent) {
    e.preventDefault();
    const targetEmail = email.trim();
    if (!targetEmail) {
      toast.error("이메일을 입력해 주세요.");
      return;
    }

    setBusy(true);
    const { error } = await supabase.auth.resetPasswordForEmail(targetEmail, {
      redirectTo: `${window.location.origin}/auth?mode=recovery`,
    });
    setBusy(false);

    if (error) {
      toast.error("비밀번호 재설정 메일을 보낼 수 없습니다. 잠시 후 다시 시도해 주세요.");
      return;
    }

    toast.success("가입된 계정이면 비밀번호 재설정 메일을 보내드립니다.");
    setResetRequestMode(false);
  }

  async function updateRecoveredPassword(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword.length < 6) {
      toast.error("비밀번호는 6자 이상 입력해 주세요.");
      return;
    }
    if (newPassword !== newPasswordConfirm) {
      toast.error("비밀번호가 일치하지 않습니다.");
      return;
    }

    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setBusy(false);

    if (error) {
      toast.error("비밀번호를 변경할 수 없습니다. 재설정 링크를 다시 요청해 주세요.");
      return;
    }

    toast.success("비밀번호가 변경되었습니다.");
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", "/auth");
    }
    navigate({ to: "/dashboard" });
  }

  async function signUp(e: React.FormEvent) {
    e.preventDefault();
    if (!SELF_SIGNUP_ENABLED) return;
    if (password !== passwordConfirm) {
      toast.error("비밀번호가 일치하지 않습니다.");
      return;
    }

    setBusy(true);
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/dashboard`,
        data: { display_name: displayName.trim() || email },
      },
    });
    setBusy(false);

    if (error) {
      toast.error(`회원가입 실패: ${error.message}`);
      return;
    }

    if (data.session) {
      navigate({ to: "/dashboard" });
      return;
    }

    toast.success("회원가입이 완료되었습니다. 이메일 인증 후 로그인해 주세요.");
    setAuthTab("signin");
    setPassword("");
    setPasswordConfirm("");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">차보임</h1>
          <p className="text-xs font-medium tracking-widest text-muted-foreground">CHABOIM</p>
          <p className="mt-1 text-sm text-muted-foreground">
            자동차 업체 AI 추천시장 분석
          </p>

        </div>
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              {recoveryMode ? "새 비밀번호 설정" : resetRequestMode ? "비밀번호 재설정" : "계정"}
            </CardTitle>
            <CardDescription>
              {recoveryMode
                ? "새 비밀번호를 입력해 계정 접근을 복구하세요."
                : resetRequestMode
                  ? "가입한 이메일로 비밀번호 재설정 링크를 보내드립니다."
                  : SELF_SIGNUP_ENABLED
                    ? "로그인하거나 베타 테스트용 새 계정을 만들 수 있습니다."
                    : "이메일과 비밀번호로 로그인하세요."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {recoveryMode ? (
              <form className="space-y-4" onSubmit={updateRecoveredPassword}>
                <div className="space-y-2">
                  <Label htmlFor="new-pw">새 비밀번호</Label>
                  <Input
                    id="new-pw"
                    type="password"
                    required
                    minLength={6}
                    autoComplete="new-password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="new-pw-confirm">새 비밀번호 확인</Label>
                  <Input
                    id="new-pw-confirm"
                    type="password"
                    required
                    minLength={6}
                    autoComplete="new-password"
                    value={newPasswordConfirm}
                    onChange={(e) => setNewPasswordConfirm(e.target.value)}
                  />
                </div>
                <Button type="submit" className="w-full" disabled={busy}>
                  {busy ? "변경 중…" : "비밀번호 변경"}
                </Button>
              </form>
            ) : resetRequestMode ? (
              <form className="space-y-4" onSubmit={requestPasswordReset}>
                <div className="space-y-2">
                  <Label htmlFor="reset-email">이메일</Label>
                  <Input
                    id="reset-email"
                    type="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <Button type="submit" className="w-full" disabled={busy}>
                  {busy ? "전송 중…" : "재설정 메일 보내기"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="w-full"
                  disabled={busy}
                  onClick={() => setResetRequestMode(false)}
                >
                  로그인으로 돌아가기
                </Button>
              </form>
            ) : SELF_SIGNUP_ENABLED ? (
              <Tabs
                value={authTab}
                onValueChange={(value) => setAuthTab(value as "signin" | "signup")}
              >
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="signin">로그인</TabsTrigger>
                  <TabsTrigger value="signup">회원가입</TabsTrigger>
                </TabsList>

                <TabsContent value="signin">
                  <form className="space-y-4 pt-4" onSubmit={signIn}>
                    <div className="space-y-2">
                      <Label htmlFor="email">이메일</Label>
                      <Input
                        id="email"
                        type="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="pw">비밀번호</Label>
                      <Input
                        id="pw"
                        type="password"
                        required
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                      />
                    </div>
                    <Button type="submit" className="w-full" disabled={busy}>
                      로그인
                    </Button>
                  </form>
                </TabsContent>

                <TabsContent value="signup">
                  <form className="space-y-4 pt-4" onSubmit={signUp}>
                    <div className="space-y-2">
                      <Label htmlFor="name">이름</Label>
                      <Input
                        id="name"
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="email2">이메일</Label>
                      <Input
                        id="email2"
                        type="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="pw2">비밀번호</Label>
                      <Input
                        id="pw2"
                        type="password"
                        required
                        minLength={6}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="pw3">비밀번호 확인</Label>
                      <Input
                        id="pw3"
                        type="password"
                        required
                        minLength={6}
                        value={passwordConfirm}
                        onChange={(e) => setPasswordConfirm(e.target.value)}
                      />
                    </div>
                    <Button type="submit" className="w-full" disabled={busy}>
                      회원가입
                    </Button>
                    <p className="text-xs leading-5 text-muted-foreground">
                      가입 후 이메일 인증이 완료되어야 로그인할 수 있습니다.
                    </p>
                  </form>
                </TabsContent>
              </Tabs>
            ) : (
              <form className="space-y-4" onSubmit={signIn}>
                <div className="space-y-2">
                  <Label htmlFor="email">이메일</Label>
                  <Input
                    id="email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="pw">비밀번호</Label>
                  <Input
                    id="pw"
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
                <Button type="submit" className="w-full" disabled={busy}>
                  로그인
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="w-full"
                  disabled={busy}
                  onClick={() => setResetRequestMode(true)}
                >
                  비밀번호를 잊으셨나요?
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
