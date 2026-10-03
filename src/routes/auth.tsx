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
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/dashboard" });
    });
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
            <CardTitle className="text-lg">계정</CardTitle>
            <CardDescription>
              {SELF_SIGNUP_ENABLED
                ? "로그인하거나 베타 테스트용 새 계정을 만들 수 있습니다."
                : "이메일과 비밀번호로 로그인하세요."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {SELF_SIGNUP_ENABLED ? (
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
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
