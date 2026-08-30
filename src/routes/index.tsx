import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRight,
  BarChart3,
  Building2,
  Layers,
  Link2,
  Repeat,
  Search,
  Sparkles,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "차보임 CHABOIM | 자동차 업체 AI 추천시장 분석" },
      {
        name: "description",
        content:
          "실제 고객 질문을 반복 측정해 자동차 업체의 AI 노출, 경쟁업체, 실제 인용 출처와 AI 추천시장의 반복 패턴을 분석합니다.",
      },
      { property: "og:title", content: "차보임 CHABOIM | 자동차 업체 AI 추천시장 분석" },
      {
        property: "og:description",
        content:
          "실제 고객 질문을 반복 측정해 자동차 업체의 AI 노출, 경쟁업체, 실제 인용 출처와 AI 추천시장의 반복 패턴을 분석합니다.",
      },

      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://manual-ai-scan.lovable.app/" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [{ rel: "canonical", href: "https://manual-ai-scan.lovable.app/" }],
  }),
  component: LandingPage,
});

const VALUE_CARDS = [
  {
    icon: BarChart3,
    title: "내 업체 AI 노출",
    body: "어떤 고객 질문에서 내 업체가 추천되고, 어떤 질문에서는 보이지 않는지 확인합니다.",
  },
  {
    icon: Building2,
    title: "나 대신 보이는 경쟁업체",
    body: "같은 질문에서 반복해 등장하는 주요 업체를 측정 과정에서 자동으로 찾아냅니다.",
  },
  {
    icon: Link2,
    title: "AI가 실제로 참고한 출처",
    body: "검색 중 스쳐간 모든 URL이 아니라, 최종 답변과 실제로 연결된 출처만 분석합니다.",
  },
  {
    icon: Layers,
    title: "고노출 업체 공통 패턴",
    body: "AI에 자주 노출되는 자동차 업체들이 어떤 출처와 반복 연결되는지 누적 관찰합니다.",
  },
];

const METHOD_STEPS = [
  {
    no: "01",
    title: "실제 고객 검색 질문 구성",
    body: "지역·추천·후기·비교처럼 손님이 실제로 물어볼 법한 질문을 정리합니다.",
  },
  {
    no: "02",
    title: "여러 질문으로 AI 답변 측정",
    body: "질문 하나가 아니라 여러 질문으로 AI 답변을 모아 확인합니다.",
  },
  {
    no: "03",
    title: "경쟁업체·인용 출처 연결 분석",
    body: "그 답변에 누가 함께 등장했고 어떤 출처가 연결됐는지 살펴봅니다.",
  },
  {
    no: "04",
    title: "반복 측정으로 재현 여부 확인",
    body: "같은 조건으로 다시 측정해 같은 결과가 또 나타나는지 확인합니다.",
  },
];

const PREVIEW_CARDS = [
  { title: "내 AI 노출 상태", labels: ["노출 비율", "상위 추천 비율", "반복 확인"] },
  { title: "지금 먼저 확인할 것", labels: ["우선 확인 질문군", "관찰된 차이"] },
  { title: "AI에서 내 업체 대신 자주 보이는 곳", labels: ["주요 경쟁업체", "함께 등장한 질문 수"] },
  { title: "AI가 실제 답변에 참고한 출처", labels: ["실제 인용 출처", "출처 유형"] },
  {
    title: "AI에 자주 추천되는 업체들의 공통 출처 패턴",
    labels: ["반복 관찰 출처", "연결 여부"],
  },
];

function LandingPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4">
          <span className="flex items-baseline gap-1.5">
            <span className="text-base font-semibold tracking-tight sm:text-lg">차보임</span>
            <span className="text-[10px] font-medium tracking-widest text-muted-foreground">
              CHABOIM
            </span>
          </span>

          <nav className="hidden items-center gap-6 text-sm text-muted-foreground md:flex">
            <a href="#service" className="transition-colors hover:text-foreground">
              서비스 소개
            </a>
            <a href="#method" className="transition-colors hover:text-foreground">
              분석 방식
            </a>
          </nav>
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link to="/auth">로그인</Link>
            </Button>
            <Button asChild size="sm">
              <Link to="/auth">회원가입</Link>
            </Button>
          </div>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="border-b bg-muted/30">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 md:py-24 lg:grid-cols-2 lg:items-center">
            <div>
              <Badge variant="outline" className="mb-4 font-normal">
                자동차 업체를 위한 AI 노출 분석
              </Badge>
              <h1 className="text-3xl font-bold leading-tight tracking-tight sm:text-4xl lg:text-5xl">
                고객이 AI에 물어볼 때,
                <br />
                우리 업체는 얼마나 보이고 있을까요?
              </h1>
              <p className="mt-5 max-w-xl text-base leading-relaxed text-muted-foreground">
                실제 고객이 검색할 만한 질문을 반복 측정해 내 업체의 AI 노출, 대신 추천되는
                경쟁업체, 실제 답변에 연결된 출처를 한 번에 분석합니다.
              </p>
              <div className="mt-7 flex flex-wrap gap-3">
                <Button asChild size="lg">
                  <Link to="/auth">
                    AI 노출 분석 시작하기
                    <ArrowRight className="ml-1 h-4 w-4" />
                  </Link>
                </Button>
                <Button asChild size="lg" variant="outline">
                  <a href="#method">어떻게 분석하나요?</a>
                </Button>
              </div>
              <p className="mt-5 text-xs text-muted-foreground">
                튜닝 · 썬팅 · 엔진오일 · 타이어/휠 · 디테일링 · PPF · 전장 등 자동차 업체 분석
              </p>
            </div>

            {/* Product-like panel */}
            <div className="space-y-3">
              <Card className="shadow-sm">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Sparkles className="h-4 w-4 text-muted-foreground" />
                    AI 노출 분석
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {[
                    { label: "내 업체 노출", state: "반복 측정" },
                    { label: "경쟁업체 발견", state: "자동 발견" },
                    { label: "실제 인용 출처", state: "답변 연결 출처" },
                  ].map((row) => (
                    <div
                      key={row.label}
                      className="flex items-center justify-between rounded-md border px-3 py-2"
                    >
                      <span className="text-sm">{row.label}</span>
                      <Badge variant="secondary" className="font-normal">
                        {row.state}
                      </Badge>
                    </div>
                  ))}
                </CardContent>
              </Card>

              <div className="flex items-center justify-center">
                <div className="h-5 w-px bg-border" aria-hidden="true" />
              </div>

              <div className="grid gap-2">
                {[
                  "근처에서 엔진오일 교환 잘하는 곳은?",
                  "이 지역에서 썬팅 잘하는 업체 추천해줘",
                  "타이어 교체 후기 좋은 곳은?",
                ].map((q) => (
                  <div
                    key={q}
                    className="flex items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm text-muted-foreground"
                  >
                    <Search className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{q}</span>
                  </div>
                ))}
              </div>

              <p className="text-center text-xs text-muted-foreground">
                고객 질문 → AI 답변 측정 → 경쟁업체·출처 분석
              </p>
            </div>
          </div>
        </section>

        {/* Service */}
        <section id="service" className="scroll-mt-20 border-b">
          <div className="mx-auto max-w-6xl px-4 py-16 md:py-20">
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
              단순 검색이 아니라, AI 추천 시장을 분석합니다.
            </h2>
            <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted-foreground sm:text-base">
              AI 답변은 질문 방식과 시점에 따라 달라질 수 있습니다. 그래서 한두 번 물어본 결과가
              아니라, 고객이 실제로 쓸 법한 여러 질문을 반복해서 확인합니다.
            </p>
            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {VALUE_CARDS.map((c) => (
                <Card key={c.title}>
                  <CardHeader className="pb-2">
                    <c.icon className="h-5 w-5 text-muted-foreground" />
                    <CardTitle className="pt-2 text-base">{c.title}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm leading-relaxed text-muted-foreground">{c.body}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        {/* Method */}
        <section id="method" className="scroll-mt-20 border-b bg-muted/30">
          <div className="mx-auto max-w-6xl px-4 py-16 md:py-20">
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
              차보임은 이렇게 분석합니다.

            </h2>
            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {METHOD_STEPS.map((s) => (
                <Card key={s.no} className="bg-background">
                  <CardHeader className="pb-2">
                    <span className="text-xs font-semibold text-muted-foreground">{s.no}</span>
                    <CardTitle className="pt-1 text-base">{s.title}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm leading-relaxed text-muted-foreground">{s.body}</p>
                  </CardContent>
                </Card>
              ))}
            </div>

            <div className="mt-8 rounded-lg border bg-background p-6">
              <p className="flex items-center gap-2 text-base font-semibold">
                <Repeat className="h-4 w-4 text-muted-foreground" />한 번의 AI 답변이 아니라,
                반복되는 패턴을 봅니다.
              </p>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                AI 답변은 매번 조금씩 달라질 수 있습니다. 그래서 한 번의 결과를 결론으로 보지 않고,
                같은 조건으로 다시 측정했을 때에도 다시 나타나는 차이를 더 중요하게 봅니다.
              </p>
            </div>
          </div>
        </section>

        {/* Research */}
        <section className="border-b">
          <div className="mx-auto max-w-6xl px-4 py-16 md:py-20">
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
              한 업체만 보지 않습니다. 자동차 AI 추천 시장을 함께 관찰합니다.
            </h2>
            <div className="mt-8 grid gap-8 lg:grid-cols-2">
              <ul className="space-y-4">
                {[
                  "등록된 업체와 측정 과정에서 발견되는 경쟁업체 데이터를 계속 누적해 관찰합니다.",
                  "AI에 자주 노출되는 업체들의 공통 출처 패턴을 최근 데이터 기준으로 다시 계산합니다.",
                  "특정 출처가 노출의 원인이라고 단정하지 않고, 반복해서 관찰되는 패턴으로만 제시합니다.",
                ].map((t) => (
                  <li key={t} className="flex gap-3 text-sm leading-relaxed text-muted-foreground">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-foreground/40" />
                    <span>{t}</span>
                  </li>
                ))}
              </ul>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {["관찰", "비교", "반복 확인", "패턴 발견"].map((step, i) => (
                  <div
                    key={step}
                    className="rounded-md border px-3 py-4 text-center text-sm font-medium"
                  >
                    <span className="block text-xs text-muted-foreground">0{i + 1}</span>
                    {step}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Preview */}
        <section className="border-b bg-muted/30">
          <div className="mx-auto max-w-6xl px-4 py-16 md:py-20">
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
              사장님이 알아야 할 핵심만 먼저 보여드립니다.
            </h2>
            <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted-foreground sm:text-base">
              복잡한 분석은 시스템이 처리하고, 화면에서는 이해하기 쉬운 결과부터 순서대로
              보여드립니다.
            </p>
            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {PREVIEW_CARDS.map((c) => (
                <Card key={c.title} className="bg-background">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm">{c.title}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {c.labels.map((l) => (
                      <div
                        key={l}
                        className="flex items-center justify-between rounded-md border px-3 py-2 text-xs text-muted-foreground"
                      >
                        <span>{l}</span>
                        <span className="h-2 w-12 rounded-full bg-muted" aria-hidden="true" />
                      </div>
                    ))}
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        {/* Bottom CTA */}
        <section>
          <div className="mx-auto max-w-3xl px-4 py-16 text-center md:py-20">
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
              AI가 고객의 새로운 검색창이 되고 있습니다.
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground sm:text-base">
              내 업체가 AI에서 어떻게 보이고 있는지, 경쟁업체와 어떤 차이가 있는지 확인해 보세요.
            </p>
            <Button asChild size="lg" className="mt-7">
              <Link to="/auth">
                내 업체 AI 노출 확인하기
                <ArrowRight className="ml-1 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </section>
      </main>

      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl flex-col gap-1 px-4 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span className="font-medium text-foreground">차보임 CHABOIM</span>
          <span className="text-xs">자동차 업체 AI 추천시장 분석</span>

        </div>
      </footer>
    </div>
  );
}
