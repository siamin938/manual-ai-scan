import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/org";
import { PLATFORM_LABELS, MANUAL_DISCLAIMER, formatSeoul } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/reports/manual")({
  head: () => ({
    meta: [
      { title: "수동 점검 고객 보고서 · 차보임 CHABOIM" },
      { name: "description", content: "사람이 직접 확인한 AI 답변 결과를 정리한 인쇄용 고객 보고서." },
      { property: "og:title", content: "수동 점검 고객 보고서 · 차보임 CHABOIM" },
      { property: "og:description", content: "수동 점검 기반 고객 보고서" },
    ],
  }),
  component: ManualReportPage,
});

type Check = {
  id: string;
  business_id: string;
  platform: string;
  prompt_text: string;
  response_text: string;
  was_client_mentioned: boolean;
  client_position: number | null;
  observed_at: string;
  logged_in: boolean;
  personalized: boolean;
  notes: string | null;
};

type Business = {
  id: string;
  name: string;
  aliases: string[];
  category: string;
  website_url: string | null;
  address: string | null;
  region: string | null;
  city: string | null;
  is_client_business: boolean;
};

/** NFKC 정규화 + 소문자 + 공백/줄바꿈/특수문자 제거 */
function normalizeText(value: string): string {
  return (value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^0-9a-z\uac00-\ud7a3\u3131-\u318e]+/g, "");
}

/** 정규화 문자열에서 needle 위치를 찾아 원문에서 대응 문구를 추출 */
function findMatchSnippet(raw: string, needle: string): string | null {
  const chars: string[] = [];
  const indexes: number[] = [];
  const normalizedRaw = (raw ?? "").normalize("NFKC").toLowerCase();
  for (let i = 0; i < normalizedRaw.length; i += 1) {
    const ch = normalizedRaw[i]!;
    if (/[0-9a-z\uac00-\ud7a3\u3131-\u318e]/.test(ch)) {
      chars.push(ch);
      indexes.push(i);
    }
  }
  const joined = chars.join("");
  const at = joined.indexOf(needle);
  if (at < 0) return null;
  const start = indexes[at]!;
  const end = indexes[at + needle.length - 1]!;
  return normalizedRaw.slice(start, end + 1) === ""
    ? null
    : (raw ?? "").normalize("NFKC").slice(start, end + 1);
}

function priorityLabel(score: number): string {

  if (score >= 80) return "최우선";
  if (score >= 60) return "높음";
  if (score >= 40) return "보통";
  return "낮음";
}

function ManualReportPage() {
  const { activeOrgId, canWrite, role } = useOrg();
  const qc = useQueryClient();
  const [businessId, setBusinessId] = useState("");
  const [recTitle, setRecTitle] = useState("");
  const [recRationale, setRecRationale] = useState("");
  const [recPriority, setRecPriority] = useState("50");
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);

  useEffect(() => {
    setGeneratedAt(new Date().toISOString());
  }, [businessId]);

  const priorityValue = Math.min(100, Math.max(0, Math.round(Number(recPriority))));
  const priorityValid = recPriority.trim() !== "" && Number.isFinite(Number(recPriority)) && Number.isInteger(Number(recPriority)) && Number(recPriority) >= 0 && Number(recPriority) <= 100;

  const { data: businesses = [] } = useQuery({
    queryKey: ["businesses-report", activeOrgId],
    enabled: !!activeOrgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("businesses")
        .select("id, name, aliases, category, website_url, address, region, city, is_client_business")
        .eq("org_id", activeOrgId!)
        .order("name");
      if (error) throw error;
      return (data ?? []) as Business[];
    },
  });

  const { data: checks = [] } = useQuery({
    queryKey: ["report-checks", activeOrgId, businessId],
    enabled: !!activeOrgId && !!businessId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("manual_ui_checks")
        .select(
          "id, business_id, platform, prompt_text, response_text, was_client_mentioned, client_position, observed_at, logged_in, personalized, notes",
        )
        .eq("org_id", activeOrgId!)
        .eq("business_id", businessId)
        .order("observed_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Check[];
    },
  });

  const { data: competitorLinks = [] } = useQuery({
    queryKey: ["business-competitors", activeOrgId, businessId],
    enabled: !!activeOrgId && !!businessId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("business_competitors")
        .select("competitor_business_id, active")
        .eq("org_id", activeOrgId!)
        .eq("target_business_id", businessId)
        .eq("active", true);
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: recommendations = [] } = useQuery({
    queryKey: ["recommendations", activeOrgId, businessId],
    enabled: !!activeOrgId && !!businessId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("recommendations")
        .select("id, title, rationale, priority_score, effort_level, status, created_at")
        .eq("org_id", activeOrgId!)
        .eq("business_id", businessId)
        .order("priority_score", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });


  const addRec = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("recommendations").insert({
        org_id: activeOrgId!,
        business_id: businessId,
        title: recTitle.trim(),
        action_type: "manual_followup",
        rationale: recRationale.trim(),
        priority_score: priorityValue,
        effort_level: "medium",
        evidence_experiments: 0,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("다음 행동 우선순위를 추가했습니다.");
      setRecTitle("");
      setRecRationale("");
      setRecPriority("50");
      qc.invalidateQueries({ queryKey: ["recommendations", activeOrgId, businessId] });
    },
    onError: (e: Error) => toast.error(`추가 실패: ${e.message}`),
  });

  const target = businesses.find((b) => b.id === businessId);
  const linkedIds = new Set(competitorLinks.map((l) => l.competitor_business_id));
  const competitors = businesses.filter(
    (b) => b.id !== businessId && (linkedIds.size > 0 ? linkedIds.has(b.id) : !b.is_client_business),
  );

  const platformsUsed = Array.from(new Set(checks.map((c) => c.platform)));
  const questionsCount = new Set(checks.map((c) => c.prompt_text)).size;
  const mentioned = checks.filter((c) => c.was_client_mentioned);

  // 저장된 값이 아니라 매번 현재 경쟁업체 목록으로 response_text 전체를 재분석
  const competitorAnalysis = competitors.map((c) => {
    const terms = [c.name, ...(c.aliases ?? [])].filter((t) => (t ?? "").trim().length > 0);
    const needles = terms.map((t) => ({ term: t, needle: normalizeText(t) })).filter((t) => t.needle.length > 0);
    const snippets: string[] = [];
    let count = 0;
    for (const check of checks) {
      const normalized = normalizeText(check.response_text);
      // 한 답변 안에서 여러 번 등장해도 1회로 집계
      const hit = needles.find((n) => normalized.includes(n.needle));
      if (hit) {
        count += 1;
        const snippet = findMatchSnippet(check.response_text, hit.needle);
        if (snippet) snippets.push(snippet);
      }
    }
    return { id: c.id, name: c.name, aliases: c.aliases ?? [], count, snippets };
  });

  const competitorMentions = competitorAnalysis
    .filter((c) => c.count > 0)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  const topCount = competitorMentions[0]?.count ?? 0;
  const topCompetitors = competitorMentions.filter((c) => c.count === topCount);

  const observations = [
    `총 ${checks.length}건의 수동 점검 중 ${mentioned.length}건에서 업체명이 답변에 포함되었습니다.`,
    platformsUsed.length > 0
      ? `확인 플랫폼: ${platformsUsed.map((p) => PLATFORM_LABELS[p]).join(", ")}`
      : "확인한 플랫폼이 없습니다.",
    topCompetitors.length > 1
      ? `가장 자주 언급된 경쟁업체(공동 1위): ${topCompetitors.map((c) => c.name).join(", ")} (각 ${topCount}건)`
      : topCompetitors.length === 1
        ? `가장 자주 언급된 경쟁업체: ${topCompetitors[0]!.name} (${topCount}건)`
        : "답변에서 등록된 경쟁업체 언급이 확인되지 않았습니다.",
  ];


  return (
    <div className="print-page space-y-6">
      <div className="no-print flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-2">
          <Label>보고 대상 업체</Label>
          <Select value={businessId} onValueChange={setBusinessId}>
            <SelectTrigger className="w-[260px]">
              <SelectValue placeholder="업체 선택" />
            </SelectTrigger>
            <SelectContent>
              {businesses
                .filter((b) => b.is_client_business)
                .map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>
        <Button variant="outline" onClick={() => window.print()} disabled={!businessId}>
          인쇄 / PDF 저장
        </Button>
      </div>

      {!target && (
        <p className="text-sm text-muted-foreground">보고서를 생성할 업체를 선택하세요.</p>
      )}

      {target && (
        <div className="space-y-6">
          <header className="border-b pb-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">차보임 CHABOIM · 수동 점검 보고서</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">{target.name}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {[target.category, target.region, target.city].filter(Boolean).join(" · ")}
              {target.website_url ? ` · ${target.website_url}` : ""}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">생성 시각(KST): {generatedAt ? formatSeoul(generatedAt) : "-"}</p>
          </header>

          <section className="grid gap-4 sm:grid-cols-3">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">확인한 플랫폼</CardTitle>
              </CardHeader>
              <CardContent className="text-sm">
                {platformsUsed.length ? platformsUsed.map((p) => PLATFORM_LABELS[p]).join(", ") : "-"}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">확인한 질문 수</CardTitle>
              </CardHeader>
              <CardContent className="text-2xl font-semibold tabular-nums">{questionsCount}</CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">업체 포함 점검</CardTitle>
              </CardHeader>
              <CardContent className="text-2xl font-semibold tabular-nums">
                {mentioned.length} / {checks.length}
              </CardContent>
            </Card>
          </section>

          <section>
            <h2 className="mb-3 text-base font-semibold">질문별 업체 포함 여부</h2>
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>측정 시각(KST)</TableHead>
                    <TableHead>플랫폼</TableHead>
                    <TableHead>질문</TableHead>
                    <TableHead>포함</TableHead>
                    <TableHead>순서</TableHead>
                    <TableHead>조건</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {checks.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="whitespace-nowrap text-xs">{formatSeoul(c.observed_at)}</TableCell>
                      <TableCell className="whitespace-nowrap text-sm">{PLATFORM_LABELS[c.platform]}</TableCell>
                      <TableCell className="text-sm">{c.prompt_text}</TableCell>
                      <TableCell>
                        <Badge variant={c.was_client_mentioned ? "default" : "secondary"}>
                          {c.was_client_mentioned ? "포함" : "미포함"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">{c.client_position ?? "-"}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {c.logged_in ? "로그인" : "비로그인"} / {c.personalized ? "개인화" : "비개인화"}
                      </TableCell>
                    </TableRow>
                  ))}
                  {checks.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                        점검 기록이 없습니다.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </section>

          <section>
            <h2 className="mb-3 text-base font-semibold">경쟁업체 언급</h2>
            {competitorMentions.length ? (
              <ul className="space-y-1 text-sm">
                {competitorMentions.map((c) => (
                  <li key={c.name} className="flex justify-between rounded-md border px-3 py-2">
                    <span>{c.name}</span>
                    <span className="tabular-nums text-muted-foreground">{c.count}건 언급</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">등록된 경쟁업체 언급이 확인되지 않았습니다.</p>
            )}
          </section>

          <section>
            <h2 className="mb-3 text-base font-semibold">주요 관찰 내용</h2>
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {observations.map((o) => (
                <li key={o}>{o}</li>
              ))}
            </ul>
          </section>

          <section>
            <h2 className="mb-3 text-base font-semibold">다음 행동 우선순위</h2>
            {recommendations.length ? (
              <ol className="space-y-2 text-sm">
                {recommendations.map((r) => (
                  <li key={r.id} className="rounded-md border p-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-medium">{r.title}</p>
                      <Badge variant="secondary">
                        {priorityLabel(Number(r.priority_score))} ({Number(r.priority_score)}점)
                      </Badge>
                    </div>
                    <p className="mt-1 text-muted-foreground">{r.rationale}</p>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-sm text-muted-foreground">등록된 다음 행동이 없습니다.</p>
            )}

            {canWrite && role !== "client_viewer" && (
              <div className="no-print mt-4 grid gap-3 rounded-md border p-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="rec-title">행동 제목</Label>
                  <Input id="rec-title" value={recTitle} onChange={(e) => setRecTitle(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="rec-prio">우선순위 점수 (0~100)</Label>
                  <Input
                    id="rec-prio"
                    type="number"
                    min="0"
                    max="100"
                    step="1"
                    value={recPriority}
                    onChange={(e) => setRecPriority(e.target.value.replace(/[^0-9]/g, ""))}
                  />
                  <p className="text-xs text-muted-foreground">
                    {priorityValid
                      ? `${priorityValue}점 · ${priorityLabel(priorityValue)}`
                      : "0에서 100 사이의 정수를 입력하세요."}
                  </p>
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="rec-why">근거</Label>
                  <Textarea
                    id="rec-why"
                    rows={2}
                    value={recRationale}
                    onChange={(e) => setRecRationale(e.target.value)}
                  />
                </div>
                <div className="sm:col-span-2">
                  <Button
                    onClick={() => addRec.mutate()}
                    disabled={!recTitle.trim() || !recRationale.trim() || !priorityValid || addRec.isPending}
                  >
                    추가
                  </Button>
                </div>
              </div>
            )}
          </section>

          <section className="no-print rounded-md border border-dashed p-4">
            <h2 className="text-sm font-semibold">임시 진단 영역 (개발 확인용)</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              연결된 경쟁업체 {competitors.length}곳 · 분석한 점검 기록 {checks.length}건
            </p>
            <div className="mt-3 space-y-2">
              {competitorAnalysis.map((c) => (
                <div key={c.id} className="rounded-md border p-3 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{c.name}</span>
                    <Badge variant={c.count > 0 ? "default" : "secondary"}>
                      {c.count > 0 ? `매칭 성공 · ${c.count}회` : "매칭 실패"}
                    </Badge>
                  </div>
                  <p className="mt-1 text-muted-foreground">별칭: {c.aliases.length ? c.aliases.join(", ") : "-"}</p>
                  <p className="mt-1 text-muted-foreground">
                    매칭된 문구: {c.snippets.length ? c.snippets.join(" | ") : "-"}
                  </p>
                </div>
              ))}
              {competitors.length === 0 && (
                <p className="text-xs text-muted-foreground">연결된 경쟁업체가 없습니다.</p>
              )}
            </div>
          </section>

          <footer className="rounded-md border bg-muted p-4 text-xs leading-relaxed text-muted-foreground">
            <p className="font-medium text-foreground">면책 문구</p>
            <p className="mt-1">{MANUAL_DISCLAIMER}</p>
            <p className="mt-1">
              본 보고서는 자동 API 측정 결과를 포함하지 않으며, 수동 점검 결과와 합산하지 않습니다.
            </p>
          </footer>
        </div>
      )}
    </div>
  );
}
