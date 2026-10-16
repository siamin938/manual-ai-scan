import { createFileRoute, Outlet, redirect, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { OrgProvider, useOrg, useSession } from "@/lib/org";
import { ActiveTargetBusinessProvider } from "@/lib/active-business";
import { OrgOnboarding } from "@/components/OrgOnboarding";
import { canViewDataAssetAdmin } from "@/lib/data-asset-admin.functions";
import { ROLE_LABELS } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    return { user: data.user };
  },
  component: AuthedLayout,
});

const NAV = [
  { to: "/dashboard", label: "AI 노출 진단" },
  { to: "/measurement-history", label: "측정 기록" },
  { to: "/businesses", label: "업체 등록" },
  { to: "/questions", label: "질문 생성" },
  { to: "/runs", label: "측정하기" },
] as const;

const INTERNAL_NAV = [
  { to: "/pilot-ops", label: "파일럿 운영" },
  { to: "/internal-observation-pipeline", label: "내부 데이터 수집" },
  { to: "/data-assets", label: "데이터 자산" },
  { to: "/measurement-credits", label: "측정권 관리" },
] as const;



function AuthedLayout() {
  const { session } = useSession();
  return (
    <OrgProvider session={session}>
      <ActiveTargetBusinessProvider>
        <Shell sessionUserId={session?.user.id ?? null} />
      </ActiveTargetBusinessProvider>
    </OrgProvider>
  );
}

function Shell({ sessionUserId }: { sessionUserId: string | null }) {
  const { memberships, activeOrgId, setActiveOrgId, role, loading } = useOrg();
  const navigate = useNavigate();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const checkDataAssetAccess = useServerFn(canViewDataAssetAdmin);
  const { data: dataAssetAccess } = useQuery({
    queryKey: ["can-view-data-asset-admin", sessionUserId],
    queryFn: () => checkDataAssetAccess({ data: undefined }),
    enabled: !!sessionUserId,
    retry: false,
    staleTime: 0,
  });
  const navItems = dataAssetAccess?.allowed ? [...NAV, ...INTERNAL_NAV] : [...NAV];



  async function signOut() {
    if (isSigningOut) return;

    setIsSigningOut(true);
    const { error } = await supabase.auth.signOut();
    if (error) {
      setIsSigningOut(false);
      return;
    }

    navigate({ to: "/auth" });
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="no-print sticky top-0 z-20 border-b border-border/90 bg-card/95 shadow-[0_1px_0_color-mix(in_oklab,var(--foreground)_3%,transparent)] backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3 lg:px-6">
          <Link to="/dashboard" className="flex min-h-9 items-baseline gap-2 border-r border-border pr-5">
            <span className="text-lg font-bold tracking-tight">차보임</span>
            <span className="text-[10px] font-semibold tracking-[0.22em] text-muted-foreground">
              CHABOIM
            </span>
          </Link>

          <nav className="order-3 flex w-full gap-1 overflow-x-auto border-t border-border/70 pt-2 md:order-none md:w-auto md:border-0 md:pt-0">
            {navItems.map((n) => (
              <Link
                key={n.to}
                to={n.to}
                className="shrink-0 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                activeProps={{ className: "shrink-0 rounded-md px-3 py-2 text-sm bg-primary/8 text-primary font-semibold" }}
              >
                {n.label}
              </Link>
            ))}
          </nav>

          <div className="ml-auto flex min-w-0 items-center gap-2">
            {memberships.length > 0 && (
              <Select value={activeOrgId ?? ""} onValueChange={setActiveOrgId}>
                <SelectTrigger className="h-9 w-[150px] border-border bg-background text-sm shadow-none sm:w-[190px]">
                  <SelectValue placeholder="조직 선택" />
                </SelectTrigger>
                <SelectContent>
                  {memberships.map((m) => (
                    <SelectItem key={m.org_id} value={m.org_id}>
                      {m.organizations?.name ?? m.org_id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {role && <Badge variant="secondary" className="hidden font-medium sm:inline-flex">{ROLE_LABELS[role]}</Badge>}
            <Button
              variant="outline"
              size="sm"
              onClick={signOut}
              disabled={isSigningOut}
            >
              {isSigningOut ? "로그아웃 중…" : "로그아웃"}
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-7 lg:px-6 lg:py-10">
        {loading || isSigningOut ? (
          <p className="py-16 text-center text-sm text-muted-foreground">
            {isSigningOut ? "로그아웃 중…" : "불러오는 중…"}
          </p>
        ) : memberships.length === 0 ? (
          <OrgOnboarding />
        ) : (
          <Outlet />
        )}
      </main>
    </div>
  );
}
