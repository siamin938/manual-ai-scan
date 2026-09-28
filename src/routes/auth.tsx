import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";

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
            <CardDescription>이메일과 비밀번호로 로그인하세요.</CardDescription>
          </CardHeader>
          <CardContent>
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
            <p className="mt-4 text-center text-xs leading-5 text-muted-foreground">
              현재 신규 가입은 열려 있지 않습니다. 이용 계정은 차보임 운영 안내 후 발급됩니다.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
