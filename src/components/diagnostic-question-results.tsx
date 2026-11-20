import { Check, CircleHelp, Minus, AlertTriangle } from "lucide-react";
import type { EntityFactsV2ReadQuestionAreaDTO } from "@/lib/entity-facts-v2-read-gateway.types";

export type PresentedQuestion = Pick<EntityFactsV2ReadQuestionAreaDTO, "questionId" | "questionText" | "intentType" | "validCount" | "confirmedMentionCount" | "unresolvedTargetCount">;
export function questionPresentationState(q: PresentedQuestion) {
  if (![q.validCount, q.confirmedMentionCount, q.unresolvedTargetCount].every(n => Number.isInteger(n) && n >= 0) || q.confirmedMentionCount + q.unresolvedTargetCount > q.validCount) return "unavailable";
  if (q.validCount === 0) return "unmeasured";
  if (q.confirmedMentionCount > 0) return "confirmed";
  return q.unresolvedTargetCount > 0 ? "uncertain" : "absent";
}
export function questionPresentationGroups(questions: readonly PresentedQuestion[]) {
  return (["confirmed", "uncertain", "absent", "unmeasured", "unavailable"] as const)
    .map(state => ({ state, rows: questions.filter(q => questionPresentationState(q) === state) }))
    .filter(group => group.rows.length > 0);
}
export function confirmedUniqueQuestionCount(questions: readonly PresentedQuestion[]) {
  return new Set(questions.filter(q => questionPresentationState(q) === "confirmed").map(q => q.questionId)).size;
}
const labels = { confirmed: "우리 업체 등장", uncertain: "추가 확인 필요", absent: "등장 미확인", unmeasured: "유효 답변 없음", unavailable: "저장 근거 확인 필요" };
export function QuestionResults({ questions }: { questions: readonly PresentedQuestion[] }) {
  const count = new Set(questions.map(q => q.questionId)).size;
  return <div className="question-presentation">
    {count > 1 && <p className="question-list-summary">질문 <strong>{count}개</strong> 중 <strong>{confirmedUniqueQuestionCount(questions)}개</strong>에서 우리 업체 등장</p>}
    {count === 0 && <p>질문별 저장 근거를 확인할 수 없습니다.</p>}
    {questionPresentationGroups(questions).map(group => <section key={group.state} aria-label={labels[group.state]}>
      <ol className="diagnostic-question-results">{group.rows.map((q, index) => {
        const Icon = group.state === "confirmed" ? Check : group.state === "uncertain" ? AlertTriangle : group.state === "absent" ? Minus : CircleHelp;
        return <li key={`${q.questionId}:${index}`} data-question-id={q.questionId} data-result={group.state}>
          <span className="question-status"><Icon aria-hidden="true"/>{labels[group.state]}</span>
          <p className="question-original">{q.questionText || "저장된 질문 원문을 확인할 수 없습니다."}</p>
          {group.state === "confirmed" && <p className="question-answer-count">AI 답변 {q.validCount}개 중 {q.confirmedMentionCount}개에 등장</p>}
          {q.unresolvedTargetCount > 0 && group.state !== "unavailable" && <p className="question-unresolved"><AlertTriangle aria-hidden="true"/>추가 확인이 필요한 답변 {q.unresolvedTargetCount}개</p>}
          {group.state === "unavailable" && <p>과거 자료 또는 일치하지 않는 저장 근거로 등장 여부를 표시할 수 없습니다.</p>}
        </li>;
      })}</ol>
    </section>)}
  </div>;
}
