import { useState } from "react";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { ArrowRight, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import landingPhoto from "@/assets/chaboim-landing.webp";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (!error && data.user) {
      throw redirect({ to: "/dashboard" });
    }
  },
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


const EXAMPLE_QUESTIONS = {
  PPF: "우리 지역에서 PPF 시공 맡길 만한 곳은?",
  썬팅: "근처에서 썬팅 작업 경험이 많은 업체는?",
  정비: "이 지역에서 엔진오일 교환할 만한 곳은?",
};
function LandingPage() {
  const [industry, setIndustry] = useState<keyof typeof EXAMPLE_QUESTIONS>("PPF");
  return (
    <div className="landing-page min-h-screen bg-background text-foreground">
      <section className="landing-hero">
        <img className="landing-photo" src={landingPhoto} alt="실버 스포츠카가 놓인 자동차 작업 공간" fetchPriority="high" />
        <header className="landing-nav landing-inner">
          <Link to="/" className="min-w-0 font-bold text-xl">차보임 <span className="text-xs font-medium">CHABOIM</span></Link>
          <nav className="hidden items-center gap-8 md:flex" aria-label="서비스 메뉴"><a href="#sample">진단 미리보기</a><a href="#method">측정 방법</a></nav>
          <div className="flex shrink-0 gap-1"><Button asChild variant="ghost"><Link to="/auth">로그인</Link></Button><Button asChild><Link to="/auth">회원가입</Link></Button></div>
        </header>
        <div className="landing-copy landing-inner">
          <p className="mb-5 text-base">자동차 업체를 위한 AI 노출 진단</p>
          <h1>손님이 AI에 물을 때,<br />우리 가게도 나올까요?</h1>
          <p className="mt-6 max-w-lg text-lg leading-8">실제 고객 질문에서 우리 업체가 등장했는지,<br className="hidden sm:block" /> 어떤 질문과 출처를 먼저 확인할지 살펴보세요.</p>
          <div className="mt-8 flex flex-wrap gap-3"><Button asChild size="lg"><Link to="/auth">내 업체 진단하기<ArrowRight aria-hidden="true" /></Link></Button><Button asChild size="lg" variant="outline"><a href="#sample">샘플 먼저 보기</a></Button></div>
        </div>
        <div className="landing-examples landing-inner">
          <div className="flex flex-wrap gap-2" aria-label="예시 업종">{(Object.keys(EXAMPLE_QUESTIONS) as Array<keyof typeof EXAMPLE_QUESTIONS>).map((name) => <Button key={name} variant={industry === name ? "default" : "ghost"} aria-pressed={industry === name} onClick={() => setIndustry(name)}>{name}</Button>)}</div>
          <p className="flex min-w-0 items-start gap-3 text-base" aria-live="polite"><Search className="mt-1 size-5 shrink-0" aria-hidden="true" />{EXAMPLE_QUESTIONS[industry]}</p>
        </div>
      </section>
      <main>
        <section id="sample" className="landing-sample scroll-mt-8">
          <div className="landing-inner grid items-start gap-10 py-16 lg:grid-cols-[0.7fr_1.3fr] lg:py-24">
            <div><p className="text-base font-medium text-primary">진단 미리보기</p><h2 className="mt-4 text-3xl font-bold leading-relaxed">어떤 질문에서<br />보였을까요?</h2><p className="mt-5 text-lg leading-8 text-muted-foreground">질문을 넓게 묻는지, 조건을 좁히는지에 따라 관찰된 결과가 다를 수 있어요.</p><p className="mt-4 text-sm text-muted-foreground">샘플 데이터로 실제 고객 결과가 아닙니다.</p><Button asChild variant="link" className="mt-5 px-0"><Link to="/sample-report">샘플 진단 결과 보기<ArrowRight aria-hidden="true" /></Link></Button></div>
            <div className="rounded-lg border bg-card p-5 sm:p-8">
              <div className="mb-6 border-b pb-4"><p className="text-base text-muted-foreground">공개 샘플 보고서</p><h3 className="mt-1 text-xl font-bold">샘플 오토케어</h3></div>
              <Tabs defaultValue="visibility"><TabsList className="grid h-auto min-h-12 w-full grid-cols-3"><TabsTrigger value="visibility">내 업체 노출</TabsTrigger><TabsTrigger value="competitors">다른 업체</TabsTrigger><TabsTrigger value="sources">인용 출처</TabsTrigger></TabsList>
                <TabsContent value="visibility" className="pt-5"><p className="text-2xl font-bold leading-10">AI 답변 24개 중 <span className="text-primary">14개</span>에 등장했어요</p><p className="mt-2 text-base text-muted-foreground">그중 13회는 상위 3곳 안에 들었어요.</p><div className="mt-6 grid gap-3 sm:grid-cols-2">{[["넓은 질문", "0/8"], ["조건을 좁힌 질문", "14/16"]].map(([label,value]) => <div key={label} className="rounded-lg bg-muted p-4"><p className="text-base">{label}</p><p className="mt-3 text-2xl font-bold tabular-nums">{value}</p></div>)}</div></TabsContent>
                <TabsContent value="competitors" className="space-y-4 pt-5">{[["경쟁업체 A","5/8"],["경쟁업체 B","4/8"]].map(([name,value]) => <div key={name} className="border-b py-4"><p className="text-lg font-semibold">{name}</p><p className="mt-2 text-base text-muted-foreground">넓은 질문 {value} 답변에서 관찰<br />독립 웹 출처 확인됨</p></div>)}</TabsContent>
                <TabsContent value="sources" className="space-y-4 pt-5"><p className="text-xl font-bold">업체 관련성이 확인된 인용 페이지 5개</p><p className="text-base leading-8">업체 프로필: 확정 등장 답변 14개 중 4개<br />자동차 플랫폼 작업 사례: 14개 중 2개</p><p className="text-sm text-muted-foreground">페이지 수와 인용된 답변 수는 다른 단위입니다.</p></TabsContent>
              </Tabs>
            </div>
          </div>
        </section>
        <section id="method" className="landing-inner scroll-mt-8 py-16"><h2 className="text-3xl font-bold">측정 방법</h2><ol className="mt-8 grid gap-6 md:grid-cols-3">{["내 업체의 지역과 서비스를 등록합니다", "저장한 고객 질문으로 AI 답변을 측정합니다", "등장 결과와 실제 인용 근거를 확인합니다"].map((text,i) => <li key={text} className="border-t py-5"><span className="text-primary">0{i+1}</span><p className="mt-3 text-lg font-semibold leading-8">{text}</p></li>)}</ol><p className="mt-5 text-base text-muted-foreground">AI 답변은 질문과 시점에 따라 달라질 수 있습니다. 특정 출처가 추천 원인이라는 뜻은 아닙니다.</p><Button asChild size="lg" className="mt-7"><Link to="/auth">내 업체 진단하기<ArrowRight aria-hidden="true" /></Link></Button></section>
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
