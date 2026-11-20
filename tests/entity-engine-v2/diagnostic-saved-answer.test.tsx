import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DiagnosticAnswerText } from "../../src/components/diagnostic-answer-text";
import { QuestionAnswerContext } from "../../src/components/diagnostic-question-answer-panel";
import { QuestionResults } from "../../src/components/diagnostic-question-results";

describe("saved diagnostic answer presentation", () => {
  it("preserves distinct paragraphs, rankings, a real cited link, and the original name spelling", () => {
    const html = renderToStaticMarkup(<DiagnosticAnswerText businessName="테스트정비 판교" text={
      "답변 첫 문장입니다.\n\n1. **테스트 정비 판교**\n2. 다른 정비소\n\n[출처](https://example.com/branch)"
    }/>);
    expect(html).toContain("<p>답변 첫 문장입니다.</p>");
    expect(html).toContain("<ol");
    expect(html).toContain("<mark>테스트 정비 판교</mark>");
    expect(html).toContain("다른 정비소");
    expect(html).toContain('href="https://example.com/branch"');
  });
  it("preserves ranges in Korean schedules and prices as saved", () => {
    const text = "월~토 11:00~20:00, 5~7만원. ~~종료~~";
    const html = renderToStaticMarkup(<DiagnosticAnswerText businessName="" text={text}/>);
    expect(html).toContain("월~토 11:00~20:00, 5~7만원.");
    expect(html).toContain("<del>종료</del>");
  });
  it("renders comparison tables and keeps untrusted HTML and embedded media inert", () => {
    const html = renderToStaticMarkup(<DiagnosticAnswerText businessName="가게" text={
      "| 업체 | 지역 |\n| --- | --- |\n| 가게 | 판교 |\n\n<em>원문 태그</em>\n\n![사진](https://example.com/a.png) [텍스트](about:blank)"
    }/>);
    expect(html).toContain("<table>");
    expect(html).toContain("&lt;em&gt;");
    expect(html).not.toContain("<img");
    expect(html).not.toContain('href="about:blank"');
  });
  it("renders readable question cards before any answer request or query client is needed", () => {
    const question = { questionId:"q",questionText:"실제 질문",intentType:"service",validCount:1,confirmedMentionCount:0,unresolvedTargetCount:0 };
    const html = renderToStaticMarkup(<QuestionAnswerContext.Provider value={{userId:"u",orgId:"o",businessId:"b",runId:"r",businessName:"가게"}}>
      <QuestionResults questions={[question]}/>
    </QuestionAnswerContext.Provider>);
    expect(html).toContain("실제 질문");
    expect(html).toContain("답변 보기");
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("AI 답변 원문");
  });
});
