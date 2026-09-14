import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/org";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/runs/$runId/shadow")({
  head: () => ({
    meta: [
      { title: "Entity v2 Shadow 진단 · 차보임 CHABOIM" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: EntityV2ShadowPage,
});

type SideDiff = {
  v1Confirmed: string[];
  v2Confirmed: string[];
  v1Only: string[];
  v2Only: string[];
};

type DecisionCounts = {
  confirmed_business: number;
  non_business: number;
  unresolved: number;
  platform: number;
  brand_network: number;
};

type ShadowPreviewItem = {
  measurement_id: string;
  parser_version: string | null;
  valid: boolean;
  match: boolean;
  mismatchCount: number;
  candidateCount: number;
  decisionCounts: DecisionCounts;
  registeredBusinesses: SideDiff;
  unregisteredBusinesses: SideDiff;
};

type ShadowPreviewResponse = {
  ok: true;
  mode: "entity-v2-shadow-preview";
  version: string;
  run_id: string;
  measurement_count: number;
  exact_match_count: number;
  diff_count: number;
  mismatch_count: number;
  registered_v1_only: number;
  registered_v2_only: number;
  unregistered_v1_only: number;
  unregistered_v2_only: number;
  api_provider_called: false;
  database_modified: false;
  preview: ShadowPreviewItem[];
};

function compactId(value: string) {
  return value.length > 12 ? `${value.slice(0, 8)}…` : value;
}

function EntityV2ShadowPage() {
  const { runId } = Route.useParams();
  const { activeOrgId } = useOrg();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ShadowPreviewResponse | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);

  const meta = useQuery({
    queryKey: ["entity-v2-shadow-meta", activeOrgId, runId],
    enabled: !!activeOrgId,
    queryFn: async () => {
      const [runResult, businessResult] = await Promise.all([
        supabase
          .from("measurement_runs")
          .select("id,name,business_id,status,run_type,phase")
          .eq("id", runId)
          .eq("org_id", activeOrgId!)
          .maybeSingle(),
        supabase
          .from("businesses")
          .select("id,name")
          .eq("org_id", activeOrgId!)
          .eq("active", true),
      ]);
      if (runResult.error) throw runResult.error;
      if (businessResult.error) throw businessResult.error;
      if (!runResult.data) throw new Error("RUN_NOT_FOUND");
      return {
        run: runResult.data,
        businessNames: new Map((businessResult.data ?? []).map((row) => [row.id, row.name])),
      };
    },
  });

  const mismatches = useMemo(
    () => (result?.preview ?? []).filter((item) => !item.match),
    [result],
  );

  const businessLabel = (id: string) => meta.data?.businessNames.get(id) ?? compactId(id);
  const labels = (values: string[], registered: boolean) =>
    values.length === 0
      ? "-"
      : values.map((value) => (registered ? businessLabel(value) : value)).join(", ");

  const runPreview = async () => {
    if (running) return;
    setRunning(true);
    setErrorText(null);
    setResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("entity-v2-shadow-preview", {
        body: { run_id: runId },
      });
      if (error) throw error;
      if (!data || data.ok !== true) {
        throw new Error(typeof data?.error === "string" ? data.error : "SHADOW_PREVIEW_FAILED");
      }
      setResult(data as ShadowPreviewResponse);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setErrorText(message || "Shadow Preview를 실행하지 못했습니다.");
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">Entity v2 Shadow 진단</h1>
            <Badge variant="outline">내부 진단</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            저장된 AI 답변을 현재 v1과 Entity v2로 비교합니다. AI API 호출과 DB 수정은 하지 않습니다.
          </p>
          {meta.data?.run ? (
            <p className="mt-1 text-xs text-muted-foreground">
              {meta.data.run.name} · {meta.data.run.status}
            </p>
          ) : null}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link to="/runs/$runId" params={{ runId }}>측정 결과로 돌아가기</Link>
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">읽기 전용 비교 실행</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
            <p>• 저장된 response_text와 v1 mention만 읽습니다.</p>
            <p>• 새로운 AI 측정을 실행하지 않습니다.</p>
            <p>• 업체 노출률·점수·고객 화면·DB 데이터를 변경하지 않습니다.</p>
          </div>
          <Button
            onClick={runPreview}
            disabled={running || meta.isLoading || !!meta.error}
          >
            {running ? "v1 ↔ v2 비교 중…" : "v1 ↔ v2 Shadow 비교 실행"}
          </Button>
          {errorText ? (
            <p className="text-sm text-destructive">{errorText}</p>
          ) : null}
        </CardContent>
      </Card>

      {result ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">전체 답변</CardTitle></CardHeader>
              <CardContent className="text-2xl font-semibold">{result.measurement_count}</CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">완전 일치</CardTitle></CardHeader>
              <CardContent className="text-2xl font-semibold">{result.exact_match_count}</CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">차이 있는 답변</CardTitle></CardHeader>
              <CardContent className="text-2xl font-semibold">{result.diff_count}</CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">차이 항목</CardTitle></CardHeader>
              <CardContent className="text-2xl font-semibold">{result.mismatch_count}</CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">방향별 차이</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-md border p-3"><p className="text-muted-foreground">등록 업체 · v1만</p><p className="mt-1 text-lg font-semibold">{result.registered_v1_only}</p></div>
                <div className="rounded-md border p-3"><p className="text-muted-foreground">등록 업체 · v2만</p><p className="mt-1 text-lg font-semibold">{result.registered_v2_only}</p></div>
                <div className="rounded-md border p-3"><p className="text-muted-foreground">미등록 업체 · v1만</p><p className="mt-1 text-lg font-semibold">{result.unregistered_v1_only}</p></div>
                <div className="rounded-md border p-3"><p className="text-muted-foreground">미등록 업체 · v2만</p><p className="mt-1 text-lg font-semibold">{result.unregistered_v2_only}</p></div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">차이 있는 답변만 보기</CardTitle>
            </CardHeader>
            <CardContent>
              {mismatches.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  이 run에서는 v1과 v2의 확정 업체 결과가 모두 일치합니다.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>답변</TableHead>
                        <TableHead>v1에만 있음</TableHead>
                        <TableHead>v2에만 있음</TableHead>
                        <TableHead>v2 판정 분포</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {mismatches.map((item) => (
                        <TableRow key={item.measurement_id}>
                          <TableCell className="font-mono text-xs">{compactId(item.measurement_id)}</TableCell>
                          <TableCell className="max-w-72 text-xs align-top">
                            <div><span className="font-medium">등록:</span> {labels(item.registeredBusinesses.v1Only, true)}</div>
                            <div className="mt-1"><span className="font-medium">미등록:</span> {labels(item.unregisteredBusinesses.v1Only, false)}</div>
                          </TableCell>
                          <TableCell className="max-w-72 text-xs align-top">
                            <div><span className="font-medium">등록:</span> {labels(item.registeredBusinesses.v2Only, true)}</div>
                            <div className="mt-1"><span className="font-medium">미등록:</span> {labels(item.unregisteredBusinesses.v2Only, false)}</div>
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-xs align-top">
                            확정 {item.decisionCounts.confirmed_business} · 미해결 {item.decisionCounts.unresolved} · 비업체 {item.decisionCounts.non_business} · 플랫폼 {item.decisionCounts.platform} · 브랜드망 {item.decisionCounts.brand_network}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
              <p className="mt-3 text-xs text-muted-foreground">
                이 화면은 Shadow 비교용입니다. v2 결과는 고객 노출·점수·저장 데이터에 반영되지 않습니다.
              </p>
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}
