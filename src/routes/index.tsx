import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRight,
  BarChart3,
  Building2,
  CircleDot,
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
    micro: "노출",
    title: "내 업체 AI 노출",
    body: "어떤 고객 질문에서 내 업체가 추천되고, 어떤 질문에서는 보이지 않는지 확인합니다.",
  },
  {
    icon: Building2,
    micro: "경쟁",
    title: "나 대신 보이는 경쟁업체",
    body: "같은 질문에서 반복해 등장하는 주요 업체를 측정 과정에서 자동으로 찾아냅니다.",
  },
  {
    icon: Link2,
    micro: "출처",
    title: "AI가 실제로 참고한 출처",
    body: "검색 중 스쳐간 모든 URL이 아니라, 최종 답변과 실제로 연결된 출처만 분석합니다.",
  },
  {
    icon: Layers,
    micro: "패턴",
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

const PREVIEW_CARDS: {
  title: string;
  labels: string[];
  tone: "primary" | "muted";
  rank: string;
}[] = [
  { title: "내 AI 노출 상태", labels: ["노출 비율", "상위 추천 비율", "반복 확인"], tone: "primary", rank: "01" },
  { title: "지금 먼저 확인할 것", labels: ["우선 확인 질문군", "관찰된 차이"], tone: "primary", rank: "02" },
  {
    title: "AI에서 내 업체 대신 자주 보이는 곳",
    labels: ["주요 경쟁업체", "함께 등장한 질문 수"],
    tone: "muted",
    rank: "03",
  },
  {
    title: "AI가 실제 답변에 참고한 출처",
    labels: ["실제 인용 출처", "출처 유형"],
    tone: "muted",
    rank: "04",
  },
  {
    title: "AI에 자주 추천되는 업체들의 공통 출처 패턴",
    labels: ["반복 관찰 출처", "연결 여부"],
    tone: "muted",
    rank: "05",
  },
];

const HERO_FLOW = [
  { label: "고객 질문", state: "질문군 구성" },
  { label: "AI 답변 측정", state: "반복 측정" },
  { label: "경쟁업체 발견", state: "자동 발견" },
  { label: "노출 개선 분석", state: "우선 제안" },
];

const RESEARCH_STEPS = [
  { step: "관찰", body: "등록 업체와 발견된 경쟁업체를 계속 지켜봅니다." },
  { step: "비교", body: "같은 질문에서 누가 함께 등장하는지 견줍니다." },
  { step: "반복 확인", body: "같은 조건으로 다시 측정해 재현 여부를 봅니다." },
  { step: "패턴 발견", body: "반복해 나타나는 흐름만 결과로 남깁니다." },
];

function LandingPage() {
  return (
    <div className="min-h-screen bg-background text-foreground [--grid-line:color-mix(in_oklab,var(--foreground)_7%,transparent)]">
      <header className="sticky top-0 z-40 border-b border-border/70 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4">
          <span className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-md border border-primary/25 bg-primary/8 text-[11px] font-bold tracking-tight text-primary">
              CB
            </span>
            <span className="flex flex-col leading-none">
              <span className="text-base font-semibold tracking-tight sm:text-[17px]">차보임</span>
              <span className="mt-0.5 text-[9px] font-medium tracking-[0.22em] text-muted-foreground">
                CHABOIM
              </span>
            </span>
          </span>

          <nav className="hidden items-center gap-7 text-sm text-muted-foreground md:flex">
            <a href="#service" className="transition-colors hover:text-foreground">
              서비스 소개
            </a>
            <a href="#method" className="transition-colors hover:text-foreground">
              분석 방식
            </a>
          </nav>
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="sm">
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
        <section className="relative overflow-hidden border-b">
          <div
            className="pointer-events-none absolute inset-0 opacity-70 [background-image:linear-gradient(to_right,var(--grid-line)_1px,transparent_1px),linear-gradient(to_bottom,var(--grid-line)_1px,transparent_1px)] [background-size:64px_64px] [mask-image:radial-gradient(ellipse_at_top_left,black,transparent_75%)]"
            aria-hidden="true"
          />
          <div className="relative mx-auto grid max-w-6xl gap-12 px-4 py-20 md:py-28 lg:grid-cols-[1.05fr_1fr] lg:items-center">
            <div>
              <Badge
                variant="outline"
                className="mb-5 gap-1.5 border-primary/30 bg-primary/5 font-normal text-primary"
              >
                <CircleDot className="h-3 w-3" />
                자동차 업체를 위한 AI 노출 분석
              </Badge>
              <h1 className="text-[2rem] font-bold leading-[1.2] tracking-[-0.02em] sm:text-[2.6rem] lg:text-[3.1rem]">
                고객이 AI에 물어볼 때,
                <br />
                <span className="relative inline-block">
                  우리 업체는 얼마나 보이고 있을까요?
                  <span
                    className="absolute -bottom-1 left-0 h-[3px] w-full rounded-full bg-primary/25"
                    aria-hidden="true"
                  />
                </span>
              </h1>
              <p className="mt-7 max-w-xl text-base leading-[1.75] text-muted-foreground">
                실제 고객이 검색할 만한 질문을 반복 측정해 내 업체의 AI 노출과 경쟁업체를 분석하고,
                차보임의 분석 로직으로 AI 노출을 위해 무엇부터 확인할지 제안합니다.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
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
              <div className="mt-8 border-l-2 border-border pl-4">
                <p className="text-xs leading-relaxed text-muted-foreground">
                  튜닝 · 썬팅 · 엔진오일 · 타이어/휠 · 디테일링 · PPF · 전장 등 자동차 업체 분석
                </p>
              </div>
            </div>

            {/* Research panel */}
            <div className="relative">
              <div
                className="absolute -inset-3 rounded-2xl border border-border/60 bg-card/40"
                aria-hidden="true"
              />
              <Card className="relative overflow-hidden shadow-sm">
                <CardHeader className="border-b pb-3">
                  <CardTitle className="flex items-center justify-between gap-2 text-sm font-medium">
                    <span className="flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-primary" />
                      AI 노출 분석 흐름
                    </span>
                    <span className="text-[10px] font-normal tracking-[0.18em] text-muted-foreground">
                      CHABOIM
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-0 pt-5">
                  <ol className="relative space-y-3 pl-6">
                    <span
                      className="absolute left-[5px] top-2 bottom-2 w-px bg-border"
                      aria-hidden="true"
                    />
                    {HERO_FLOW.map((row) => (
                      <li key={row.label} className="relative">
                        <span
                          className="absolute -left-6 top-3 h-2.5 w-2.5 rounded-full border-2 border-primary/60 bg-background"
                          aria-hidden="true"
                        />
                        <div className="flex items-center justify-between gap-2 rounded-md border bg-card px-3 py-2">
                          <span className="text-sm font-medium">{row.label}</span>
                          <Badge variant="secondary" className="font-normal">
                            {row.state}
                          </Badge>
                        </div>
                      </li>
                    ))}
                  </ol>

                  <div className="mt-5 rounded-md border border-dashed bg-muted/40 p-3">
                    <p className="mb-2 text-[11px] font-medium tracking-wide text-muted-foreground">
                      측정에 쓰이는 고객 질문 예시
                    </p>
                    <div className="grid gap-1.5">
                      {[
                        "근처에서 엔진오일 교환 잘하는 곳은?",
                        "이 지역에서 썬팅 잘하는 업체 추천해줘",
                        "타이어 교체 후기 좋은 곳은?",
                      ].map((q) => (
                        <div
                          key={q}
                          className="flex items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm text-muted-foreground"
                        >
                          <Search className="h-3.5 w-3.5 shrink-0 text-primary/70" />
                          <span className="truncate">{q}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <p className="mt-4 text-center text-xs text-muted-foreground">
                    고객 질문 → AI 답변 측정 → 경쟁업체 분석 → 우선 확인 항목 제안
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>
        </section>

        {/* Service */}
        <section id="service" className="scroll-mt-20 border-b">
          <div className="mx-auto max-w-6xl px-4 py-20 md:py-24">
            <div className="max-w-3xl">
              <p className="mb-3 text-[11px] font-semibold tracking-[0.2em] text-primary">
                SERVICE
              </p>
              <h2 className="text-2xl font-bold tracking-tight sm:text-[1.85rem]">
                단순 검색이 아니라, AI 추천 시장을 분석합니다.
              </h2>
              <p className="mt-4 text-sm leading-[1.75] text-muted-foreground sm:text-base">
                AI 답변은 질문 방식과 시점에 따라 달라질 수 있습니다. 그래서 한두 번 물어본 결과가
                아니라, 고객이 실제로 쓸 법한 여러 질문을 반복해서 확인합니다.
              </p>
            </div>
            <div className="mt-10 grid gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-2 lg:grid-cols-4">
              {VALUE_CARDS.map((c, i) => (
                <div
                  key={c.title}
                  className="group bg-card p-6 transition-colors hover:bg-muted/40"
                >
                  <div className="flex items-center justify-between">
                    <c.icon className="h-5 w-5 text-primary" />
                    <span className="text-[10px] font-semibold tracking-[0.18em] text-muted-foreground">
                      {String(i + 1).padStart(2, "0")} · {c.micro}
                    </span>
                  </div>
                  <h3 className="mt-5 text-base font-semibold tracking-tight">{c.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{c.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Method */}
        <section id="method" className="scroll-mt-20 border-b bg-muted/30">
          <div className="mx-auto max-w-6xl px-4 py-20 md:py-24">
            <p className="mb-3 text-[11px] font-semibold tracking-[0.2em] text-primary">METHOD</p>
            <h2 className="text-2xl font-bold tracking-tight sm:text-[1.85rem]">
              차보임은 이렇게 분석합니다.
            </h2>

            <div className="relative mt-10">
              <span
                className="pointer-events-none absolute left-0 right-0 top-[38px] hidden h-px bg-border lg:block"
                aria-hidden="true"
              />
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {METHOD_STEPS.map((s) => (
                  <div key={s.no} className="relative">
                    <div className="mb-4 flex items-center gap-3">
                      <span className="flex h-7 w-7 items-center justify-center rounded-full border border-primary/30 bg-background text-[11px] font-semibold text-primary">
                        {s.no}
                      </span>
                      <span className="hidden h-px flex-1 bg-border lg:block" aria-hidden="true" />
                    </div>
                    <div className="rounded-lg border bg-background p-5">
                      <h3 className="text-base font-semibold tracking-tight">{s.title}</h3>
                      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{s.body}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-10 rounded-xl border border-primary/20 bg-background p-7">
              <div className="flex items-start gap-4">
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10">
                  <Repeat className="h-4 w-4 text-primary" />
                </span>
                <div>
                  <p className="text-[11px] font-semibold tracking-[0.18em] text-primary">
                    분석 원칙
                  </p>
                  <p className="mt-1.5 text-base font-semibold tracking-tight sm:text-lg">
                    한 번의 AI 답변이 아니라, 반복되는 패턴을 봅니다.
                  </p>
                  <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
                    AI 답변은 매번 조금씩 달라질 수 있습니다. 그래서 한 번의 결과를 결론으로 보지
                    않고, 같은 조건으로 다시 측정했을 때에도 다시 나타나는 차이를 더 중요하게
                    봅니다.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Research */}
        <section className="border-b">
          <div className="mx-auto max-w-6xl px-4 py-20 md:py-24">
            <div className="max-w-3xl">
              <p className="mb-3 text-[11px] font-semibold tracking-[0.2em] text-primary">
                RESEARCH
              </p>
              <h2 className="text-2xl font-bold tracking-tight sm:text-[1.85rem]">
                한 업체만 보지 않습니다. 자동차 AI 추천 시장을 함께 관찰합니다.
              </h2>
            </div>

            <div className="mt-10 grid gap-10 lg:grid-cols-[1fr_1.1fr]">
              <ul className="space-y-5 border-l pl-6">
                {[
                  "등록된 업체와 측정 과정에서 발견되는 경쟁업체 데이터를 계속 누적해 관찰합니다.",
                  "AI에 자주 노출되는 업체들의 공통 출처 패턴을 최근 데이터 기준으로 다시 계산합니다.",
                  "특정 출처가 노출의 원인이라고 단정하지 않고, 반복해서 관찰되는 패턴으로만 제시합니다.",
                ].map((t) => (
                  <li key={t} className="relative text-sm leading-[1.75] text-muted-foreground">
                    <span
                      className="absolute -left-[27px] top-2 h-1.5 w-1.5 rounded-full bg-primary/70"
                      aria-hidden="true"
                    />
                    {t}
                  </li>
                ))}
              </ul>

              <div className="grid gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-2">
                {RESEARCH_STEPS.map((s, i) => (
                  <div key={s.step} className="bg-card p-5">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-semibold tracking-[0.18em] text-muted-foreground">
                        0{i + 1}
                      </span>
                      <span
                        className="h-px flex-1 bg-border"
                        aria-hidden="true"
                      />
                    </div>
                    <p className="mt-3 text-sm font-semibold tracking-tight">{s.step}</p>
                    <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{s.body}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Preview */}
        <section className="border-b bg-muted/30">
          <div className="mx-auto max-w-6xl px-4 py-20 md:py-24">
            <div className="max-w-3xl">
              <p className="mb-3 text-[11px] font-semibold tracking-[0.2em] text-primary">REPORT</p>
              <h2 className="text-2xl font-bold tracking-tight sm:text-[1.85rem]">
                사장님이 알아야 할 핵심만 먼저 보여드립니다.
              </h2>
              <p className="mt-4 text-sm leading-[1.75] text-muted-foreground sm:text-base">
                복잡한 분석은 시스템이 처리하고, 화면에서는 이해하기 쉬운 결과부터 순서대로
                보여드립니다.
              </p>
            </div>

            <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {PREVIEW_CARDS.map((c) => (
                <Card
                  key={c.title}
                  className={
                    c.tone === "primary"
                      ? "border-primary/30 bg-background"
                      : "bg-background"
                  }
                >
                  <CardHeader className="border-b pb-3">
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle className="text-sm leading-snug">{c.title}</CardTitle>
                      <span className="text-[10px] font-semibold tracking-[0.18em] text-muted-foreground">
                        {c.rank}
                      </span>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-2 pt-4">
                    {c.labels.map((l) => (
                      <div
                        key={l}
                        className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-xs text-muted-foreground"
                      >
                        <span>{l}</span>
                        <span className="flex items-center gap-1" aria-hidden="true">
                          <span
                            className={`h-1.5 w-10 rounded-full ${
                              c.tone === "primary" ? "bg-primary/30" : "bg-muted-foreground/20"
                            }`}
                          />
                          <span className="h-1.5 w-4 rounded-full bg-muted-foreground/15" />
                        </span>
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
          <div className="mx-auto max-w-3xl px-4 py-20 text-center md:py-24">
            <h2 className="text-2xl font-bold tracking-tight sm:text-[1.85rem]">
              AI가 고객의 새로운 검색창이 되고 있습니다.
            </h2>
            <p className="mt-4 text-sm leading-[1.75] text-muted-foreground sm:text-base">
              내 업체가 AI에서 어떻게 보이고 있는지, 경쟁업체와 어떤 차이가 있는지 확인해 보세요.
            </p>
            <Button asChild size="lg" className="mt-8">
              <Link to="/auth">
                내 업체 AI 노출 확인하기
                <ArrowRight className="ml-1 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </section>
      </main>

      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl flex-col gap-1 px-4 py-10 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span className="flex items-baseline gap-2">
            <span className="font-semibold text-foreground">차보임</span>
            <span className="text-[10px] tracking-[0.22em]">CHABOIM</span>
          </span>
          <span className="text-xs">자동차 업체 AI 추천시장 분석</span>
        </div>
      </footer>
    </div>
  );
}
