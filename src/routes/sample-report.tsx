import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRight,
  BarChart3,
  Building2,
  FileCheck2,
  Link2,
  Search,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

export const Route = createFileRoute("/sample-report")({
  head: () => ({
    meta: [
      { title: "샘플 AI 노출 진단 · 차보임 CHABOIM" },
      {
        name: "description",
        content:
          "차보임 AI 노출 진단 결과가 어떤 방식으로 제공되는지 확인할 수 있는 공개 샘플 리포트입니다.",
      },
      { property: "og:title", content: "샘플 AI 노출 진단 · 차보임 CHABOIM" },
      {
        property: "og:description",
        content: "24개 고객 질문의 AI 노출·기준 검색·관찰 업체·출처 연결 차이를 보여주는 샘플입니다.",
      },
    ],
  }),
  component: SampleReportPage,
});

const SEARCH_CONTEXTS = [
  { label: "비교", value: 2, total: 3 },
  { label: "탐색·발견", value: 2, total: 3 },
  { label: "지역·접근성", value: 2, total: 3 },
] as const;

const SAMPLE_COMPETITORS = [
  {
    name: "비교 업체 A",
    exposure: "5/8",
    top3: "4회",
    contexts: "5종",
    source: "독립 웹 출처 A",
  },
  {
    name: "비교 업체 B",
    exposure: "4/8",
    top3: "0회",
    contexts: "4종",
    source: "독립 웹 출처 B",
  },
] as const;

const SAMPLE_SOURCES = [
  {
    label: "업체 프로필",
    title: "샘플 업체 · 지역 업체 프로필",
    exposure: "4/14 확정 노출건",
  },
  {
    label: "자동차 플랫폼",
    title: "신차패키지 작업 사례 · 샘플 업체",
    exposure: "2/14 확정 노출건",
  },
  {
    label: "자동차 플랫폼",
    title: "PPF 시공 사례 · 샘플 업체",
    exposure: "2/14 확정 노출건",
  },
] as const;

function SampleReportPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b bg-card/95">
        <div className="mx-auto flex min-h-16 max-w-6xl items-center justify-between gap-4 px-4 py-3 lg:px-6">
          <Link to="/" className="flex items-baseline gap-2">
            <span className="text-lg font-bold tracking-tight">차보임</span>
            <span className="text-[10px] font-semibold tracking-[0.22em] text-muted-foreground">
              CHABOIM
            </span>
          </Link>
          <div className="flex items-center gap-2">
            <Badge variant="secondary">공개 샘플</Badge>
            <Button asChild size="sm">
              <Link to="/auth">내 업체 진단하기</Link>
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-8 px-4 py-10 lg:px-6 lg:py-14">
        <section className="border-b pb-7">
          <p className="mb-3 text-[11px] font-semibold tracking-[0.2em] text-primary">
            AI VISIBILITY SAMPLE
          </p>
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
                샘플 AI 노출 진단
              </h1>
              <p className="mt-3 max-w-2xl text-base leading-7 text-muted-foreground">
                차보임에서 실제 고객에게 제공되는 결과의 구조를 보여주는 영업용 샘플입니다.
                업체명·경쟁업체·출처는 익명화된 예시이며 실제 고객 측정 결과가 아닙니다.
              </p>
            </div>
            <Badge variant="outline" className="w-fit border-primary/30 bg-primary/5 text-primary">
              샘플 데이터 · 실제 고객 결과 아님
            </Badge>
          </div>
          <p className="mt-4 text-sm font-medium">대상 업체 · 샘플 오토케어</p>
        </section>

        <section className="rounded-xl border border-primary/20 bg-accent/70 px-5 py-6 sm:px-7">
          <div className="flex items-start gap-4">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <BarChart3 aria-hidden="true" />
            </div>
            <div>
              <p className="text-xl font-semibold leading-8 sm:text-2xl">
                24번 물어봤더니 샘플 업체는 <strong className="text-primary">14번</strong> 나왔고,
                그중 <strong className="text-primary">13번</strong>은{" "}
                <strong className="text-primary">상위 3곳</strong> 안에 나왔습니다.
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                샘플 측정 기준 · AI 답변 24건
              </p>
            </div>
          </div>
        </section>

        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            {
              icon: BarChart3,
              label: "내 업체가 나온 답변",
              value: "14건",
              note: "24개 답변 중 · 58.33%",
            },
            {
              icon: Search,
              label: "기준 검색 노출",
              value: "0/8",
              note: "넓은 지역 · 주력 서비스 · 0%",
            },
            {
              icon: FileCheck2,
              label: "내 업체 관련 페이지",
              value: "5개",
              note: "페이지 내용 기준 관련 확인",
            },
            {
              icon: Building2,
              label: "가장 자주 함께 나온 업체",
              value: "비교 업체 A",
              note: "AI 답변에서 5건 관찰",
            },
          ].map((item) => (
            <Card key={item.label} className="shadow-none">
              <CardContent className="p-5">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <item.icon className="size-4" aria-hidden="true" />
                  <p className="text-sm font-medium">{item.label}</p>
                </div>
                <p className="mt-4 text-2xl font-bold leading-tight">{item.value}</p>
                <p className="mt-3 text-xs leading-5 text-muted-foreground">{item.note}</p>
              </CardContent>
            </Card>
          ))}
        </section>

        <section className="grid gap-5 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-xl">어떤 검색에서 보였나요?</CardTitle>
              <p className="text-sm leading-6 text-muted-foreground">
                실제 진단에서는 8개 검색 상황을 묶어 노출이 확인된 질문군을 보여드립니다.
              </p>
            </CardHeader>
            <CardContent className="space-y-5">
              {SEARCH_CONTEXTS.map((item) => (
                <div key={item.label}>
                  <div className="mb-2 flex items-center justify-between gap-4 text-sm">
                    <span className="font-medium">{item.label}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {item.value}/{item.total}
                    </span>
                  </div>
                  <Progress value={(item.value / item.total) * 100} />
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-xl">검색 범위 요약</CardTitle>
              <p className="text-sm leading-6 text-muted-foreground">
                같은 측정 안에서 상세 검색과 더 넓은 기준 검색을 분리해 봅니다.
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="divide-y rounded-lg border px-4">
                {[
                  ["상세 검색", "14/16", "87.5%"],
                  ["기준 검색", "0/8", "0%"],
                  ["전체", "14/24", "58.33%"],
                ].map(([label, count, pct]) => (
                  <div key={label} className="flex items-center justify-between gap-4 py-3">
                    <span className="text-sm font-medium">{label}</span>
                    <span className="text-sm font-semibold tabular-nums">
                      {count}
                      <span className="ml-2 font-normal text-muted-foreground">{pct}</span>
                    </span>
                  </div>
                ))}
              </div>
              <div className="rounded-lg border border-primary/20 bg-primary/[0.03] p-4">
                <p className="text-xs font-semibold text-primary">
                  이번 샘플에서 확인되는 검색 범위 차이
                </p>
                <p className="mt-2 text-sm font-semibold leading-6">
                  상세 검색 14/16에서는 확인됐지만, 기준 검색 0/8에서는 확인되지 않았습니다.
                </p>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  실제 리포트에서는 이 차이와 함께 반복 관찰된 업체와 공개 출처 연결을 비교합니다.
                </p>
              </div>
            </CardContent>
          </Card>
        </section>

        <Card className="border-primary/20">
          <CardHeader>
            <p className="text-[11px] font-semibold tracking-[0.18em] text-primary">
              OBSERVED DIFFERENCE
            </p>
            <CardTitle className="text-xl">기준 검색에서는 누가 반복 관찰됐나요?</CardTitle>
            <p className="text-sm leading-6 text-muted-foreground">
              내 업체가 보이지 않은 넓은 검색에서 반복 확인된 다른 업체와 독립 웹 연결을 함께 봅니다.
            </p>
          </CardHeader>
          <CardContent className="grid gap-3">
            {SAMPLE_COMPETITORS.map((item) => (
              <div
                key={item.name}
                className="grid gap-3 rounded-lg border p-4 sm:grid-cols-[1.2fr_auto] sm:items-center"
              >
                <div>
                  <p className="font-semibold">{item.name}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    기준 검색 {item.exposure} · Top3 {item.top3} · 검색 상황 {item.contexts}
                  </p>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Link2 className="size-4" aria-hidden="true" />
                  {item.source}
                </div>
              </div>
            ))}
            <p className="text-xs leading-5 text-muted-foreground">
              반복 관찰과 출처 연결은 관찰 결과이며, 특정 출처가 AI 노출의 원인임을 의미하지 않습니다.
            </p>
          </CardContent>
        </Card>

        <section className="grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
          <Card>
            <CardHeader>
              <CardTitle className="text-xl">확인된 출처 연결 차이</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="rounded-lg border bg-muted/20 p-4">
                <p className="text-sm font-semibold">
                  공식 홈페이지·브랜드 페이지 연결에서 확인되는 차이
                </p>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  비교 가능한 고노출 업체 일부에서는 업체·브랜드 홈페이지나 독립 사이트 출처가
                  반복 관찰됐지만, 이 샘플의 기준 검색에서는 내 업체의 같은 연결이 확인되지 않은
                  상황을 예시로 보여줍니다.
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-xl">관련성이 확인된 출처</CardTitle>
              <p className="text-sm leading-6 text-muted-foreground">
                실제 서비스에서는 AI가 인용한 페이지 자체에서 내 업체 관련성이 확인된 항목을 보여드립니다.
              </p>
            </CardHeader>
            <CardContent className="divide-y">
              {SAMPLE_SOURCES.map((source) => (
                <div key={source.title} className="py-3 first:pt-0 last:pb-0">
                  <p className="text-xs font-semibold text-primary">{source.label}</p>
                  <p className="mt-1 text-sm font-medium">{source.title}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{source.exposure}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </section>

        <Card>
          <CardHeader>
            <CardTitle className="text-xl">재측정하면 무엇이 달라지나요?</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm leading-6 text-muted-foreground">
              같은 질문과 측정 조건이 확인된 결과끼리만 비교해 상세 검색 변화, 기준 검색 변화,
              새로 확인된 노출과 이번에 사라진 노출을 구분합니다. 한 번의 결과만으로 상승·하락을
              단정하지 않습니다.
            </p>
          </CardContent>
        </Card>

        <section className="rounded-xl border border-primary/20 bg-primary/[0.03] px-5 py-7 text-center sm:px-8">
          <p className="text-sm font-semibold text-primary">CHABOIM AI VISIBILITY DIAGNOSTIC</p>
          <h2 className="mt-2 text-2xl font-bold tracking-tight">
            이제 내 업체의 실제 결과를 확인해보세요.
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
            실제 진단에서는 업체의 지역·서비스·브랜드·차종을 반영한 24개 질문으로 측정하고,
            결과와 근거를 고객 전용 대시보드와 PDF로 제공합니다.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Button asChild size="lg">
              <Link to="/auth">
                내 업체 진단 시작하기
                <ArrowRight className="ml-1 size-4" aria-hidden="true" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link to="/">서비스 소개로 돌아가기</Link>
            </Button>
          </div>
        </section>
      </main>
    </div>
  );
}
