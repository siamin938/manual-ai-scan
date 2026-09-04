import { createFileRoute, Outlet, redirect, Link, useNavigate } from "@tanstack/react-router";
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
  { to: "/dashboard", label: "내 AI 노출" },
  { to: "/businesses", label: "내 업체" },
  { to: "/questions", label: "검색 질문" },
  { to: "/runs", label: "측정하기" },
] as const;

const INTERNAL_NAV = [
  { to: "/data-assets", label: "데이터 자산" },
  { to: "/measurement-credits", label: "측정권 관리" },
] as const;



function AuthedLayout() {
  const { session } = useSession();
  return (
    <OrgProvider session={session}>
      <ActiveTargetBusinessProvider>
        <Shell />
      </ActiveTargetBusinessProvider>
    </OrgProvider>
  );
}

function Shell() {
  const { memberships, activeOrgId, setActiveOrgId, role, loading } = useOrg();
  const navigate = useNavigate();
  const checkDataAssetAccess = useServerFn(canViewDataAssetAdmin);
  const { data: dataAssetAccess } = useQuery({
    queryKey: ["can-view-data-asset-admin"],
    queryFn: () => checkDataAssetAccess({ data: undefined }),
    retry: false,
    staleTime: Infinity,
  });
  const navItems = dataAssetAccess?.allowed ? [...NAV, ...INTERNAL_NAV] : [...NAV];



  async function signOut() {
    await supabase.auth.signOut();
    navigate({ to: "/auth" });
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="no-print sticky top-0 z-20 border-b bg-card">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-3">
          <Link to="/dashboard" className="flex items-baseline gap-1.5">
            <span className="text-sm font-semibold tracking-tight">차보임</span>
            <span className="text-[10px] font-medium tracking-widest text-muted-foreground">
              CHABOIM
            </span>
          </Link>

          <nav className="order-3 flex w-full flex-wrap gap-1 md:order-none md:w-auto">
            {navItems.map((n) => (
              <Link
                key={n.to}
                to={n.to}
                className="rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                activeProps={{ className: "rounded-md px-3 py-1.5 text-sm bg-secondary text-foreground font-medium" }}
              >
                {n.label}
              </Link>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            {memberships.length > 0 && (
              <Select value={activeOrgId ?? ""} onValueChange={setActiveOrgId}>
                <SelectTrigger className="h-8 w-[180px] text-xs">
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
            {role && <Badge variant="secondary">{ROLE_LABELS[role]}</Badge>}
            <Button variant="outline" size="sm" onClick={signOut}>
              로그아웃
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">
        {loading ? (
          <p className="py-16 text-center text-sm text-muted-foreground">불러오는 중…</p>
        ) : memberships.length === 0 ? (
          <OrgOnboarding />
        ) : (
          <Outlet />
        )}
      </main>
    </div>
  );
}
