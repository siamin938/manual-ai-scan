import { createContext, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getDiagnosticQuestionAnswers, type QuestionAnswerScope } from "@/lib/diagnostic-question-answers.functions";
import { DiagnosticAnswerText } from "./diagnostic-answer-text";

type AnswerScope = QuestionAnswerScope & { businessName: string; userId: string };
export const QuestionAnswerContext = createContext<AnswerScope | null>(null);

export function DiagnosticQuestionAnswerPanel({ scope, questionId, measurementId }: { scope: AnswerScope; questionId: string; measurementId?: string }) {
  const [active, setActive] = useState(0);
  const readAnswers = useServerFn(getDiagnosticQuestionAnswers);
  const { orgId, businessId, runId, businessName, userId } = scope;
  const result = useQuery({
    queryKey: ["diagnostic-question-answers", userId, orgId, businessId, runId, questionId],
    queryFn: () => readAnswers({ data: { orgId, businessId, runId, questionId } }),
    staleTime: 300_000, retry: false,
  });
  if (result.isPending) return <p role="status">저장된 답변을 불러오는 중입니다…</p>;
  if (result.isError) return <p role="status">답변을 불러오지 못했습니다. <button type="button" onClick={() => void result.refetch()}>다시 시도</button></p>;
  const answers = measurementId ? result.data.filter(answer => answer.id === measurementId) : result.data;
  const answer = answers[active] ?? answers[0];
  if (!answer) return <p>이 질문에 저장된 답변이 없습니다.</p>;
  return <>
    <div className="saved-answer-heading"><h4>AI 답변 원문</h4>
      <span>{answer.provider === "openai" ? "OpenAI" : answer.provider}</span>
    </div>
    {answers.length > 1 && <div className="saved-answer-picker" role="group" aria-label="저장된 답변 선택">
      {answers.map((a,i) => <button key={a.id} type="button" aria-pressed={a.id === answer.id} onClick={() => setActive(i)}>답변 {i+1}</button>)}
    </div>}
    {answer.valid === false && <p className="saved-answer-note">측정에서 유효 답변으로 집계되지 않았습니다.</p>}
    {answer.text?.trim() ? <DiagnosticAnswerText text={answer.text} businessName={businessName}/> : <p>이 답변의 원문이 저장되어 있지 않습니다.</p>}
  </>;
}
