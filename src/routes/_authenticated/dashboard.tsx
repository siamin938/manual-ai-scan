import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/org";
import { formatSeoul, PLATFORM_LABELS, MANUAL_DISCLAIMER } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "대시보드 · AI Visibility Lab" },
      { name: "description", content: "등록 업체, 질문, 수동 UI 점검 현황을 한눈에 확인하는 운영 대시보드." },
      { property: "og:title", content: "대시보드 · AI Visibility Lab" },
      { property: "og:description", content: "수동 점검 기반 AI 노출 현황 요약" },
    ],
  }),
  component: DashboardPage,
});

type Check = {
  id: string;
  platform: string;
  prompt_text: string;
  was_client_mentioned: boolean;
  client_position: number | null;
  observed_at: string;
  business_id: string;
};

function DashboardPage() {
  const { activeOrgId } = useOrg();

  const { data, isLoading } = useQuery({
    queryKey: ["dashboard", activeOrgId],
    enabled: !!activeOrgId,
    queryFn: async () => {
      const [biz, q, checks] = await Promise.all([
        supabase.from("businesses").select("id, name, is_client_business, active").eq("org_id", activeOrgId!),
        supabase.from("questions").select("id, active").eq("org_id", activeOrgId!),
        supabase
          .from("manual_ui_checks")
          .select("id, platform, prompt_text, was_client_mentioned, client_position, observed_at, business_id")
          .eq("org_id", activeOrgId!)
          .order("observed_at", { ascending: false })
          .limit(200),
      ]);
      if (biz.error) throw biz.error;
      if (q.error) throw q.error;
      if (checks.error) throw checks.error;
      return {
        businesses: biz.data ?? [],
        questions: q.data ?? [],
        checks: (checks.data ?? []) as Check[],
      };
    },
  });

  const businesses = data?.businesses ?? [];
  const checks = data?.checks ?? [];
  const bizName = (id: string) => businesses.find((b) => b.id === id)?.name ?? "-";

  const chartData = Object.keys(PLATFORM_LABELS).map((p) => {
    const rows = checks.filter((c) => c.platform === p);
    return {
      platform: PLATFORM_LABELS[p]!,
      포함: rows.filter((c) => c.was_client_mentioned).length,
      미포함: rows.filter((c) => !c.was_client_mentioned).length,
    };
  });

  const stats = [
    { label: "등록 업체 수", value: businesses.filter((b) => b.active).length },
    { label: "등록 질문 수", value: (data?.questions ?? []).filter((q) => q.active).length },
    { label: "수동 점검 수", value: checks.length },
    {
      label: "업체 포함 점검",
      value: checks.filter((c) => c.was_client_mentioned).length,
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">대시보드</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          사람이 직접 확인한 수동 점검 기록만 집계합니다. 자동 API 측정 결과와 합산하지 않습니다.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{s.label}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-semibold tabular-nums">{isLoading ? "–" : s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">플랫폼별 업체 포함 횟수</CardTitle>
        </CardHeader>
        <CardContent className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="platform" fontSize={12} />
              <YAxis allowDecimals={false} fontSize={12} />
              <Tooltip />
              <Bar dataKey="포함" fill="var(--color-chart-1)" radius={[4, 4, 0, 0]} />
              <Bar dataKey="미포함" fill="var(--color-chart-2)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">최근 수동 점검</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>측정 시각(KST)</TableHead>
                <TableHead>업체</TableHead>
                <TableHead>플랫폼</TableHead>
                <TableHead>질문</TableHead>
                <TableHead>포함</TableHead>
                <TableHead>순서</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {checks.slice(0, 10).map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="whitespace-nowrap text-xs">{formatSeoul(c.observed_at)}</TableCell>
                  <TableCell className="whitespace-nowrap text-sm">{bizName(c.business_id)}</TableCell>
                  <TableCell className="whitespace-nowrap text-sm">{PLATFORM_LABELS[c.platform]}</TableCell>
                  <TableCell className="max-w-[320px] truncate text-sm">{c.prompt_text}</TableCell>
                  <TableCell>
                    <Badge variant={c.was_client_mentioned ? "default" : "secondary"}>
                      {c.was_client_mentioned ? "포함" : "미포함"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm">{c.client_position ?? "-"}</TableCell>
                </TableRow>
              ))}
              {checks.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                    아직 수동 점검 기록이 없습니다.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">{MANUAL_DISCLAIMER}</p>
    </div>
  );
}
