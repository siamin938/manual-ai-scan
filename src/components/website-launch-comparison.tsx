import { useContext, useState } from "react";
import { ArrowRight, ChevronDown, Globe2 } from "lucide-react";
import { DiagnosticQuestionAnswerPanel, QuestionAnswerContext } from "./diagnostic-question-answer-panel";
import type { ReviewedWebsiteLaunch } from "@/lib/reviewed-website-launch";

const shortDate = (iso: string) => iso.split("-").slice(1).map(Number).join("/");

export function WebsiteLaunchComparison({ review, printExpanded = false }: {
  review: ReviewedWebsiteLaunch; printExpanded?: boolean;
}) {
  const scope = useContext(QuestionAnswerContext);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [before, after] = review.runs;
  if (!before || !after) return null;
  const expanded = open || printExpanded;
  const linked = review.added.filter(q => q.linked).length;
  return <section className="website-launch" aria-label="홈페이지 공개 전후">
    <details open={expanded} onToggle={e => {
      const show = e.currentTarget.open;
      if (!printExpanded) setOpen(show);
      if (!show) setSelected(null);
    }}>
      <summary>
        <Globe2 className="launch-icon" aria-hidden="true" />
        <span className="launch-label"><strong>홈페이지 공개 전후</strong><small>{Number(review.publishedOn.slice(5, 7))}월 {Number(review.publishedOn.slice(8))}일 공개</small></span>
        <span className="launch-result"><span className="sr-only">공개 전 </span>{before.mentioned}개 <ArrowRight aria-hidden="true" /><span className="sr-only">공개 후 </span><b>{after.mentioned}개</b><small>답변에 등장</small></span>
        <ChevronDown className="launch-chevron" aria-hidden="true" />
      </summary>
      <div className="launch-body">
        <p>같은 질문 {review.questionCount}개에서 확인한 결과예요.</p>
        <table><caption className="sr-only">측정일별 업체 등장 및 홈페이지 직접 인용 답변 수</caption><thead><tr><th scope="col">측정일</th><th scope="col">업체 등장</th><th scope="col">홈페이지 인용</th></tr></thead>
          <tbody>{review.runs.map((run,i) => <tr key={run.id}><th scope="row">{shortDate(run.day)} <small>{["공개 전","공개 후","재측정"][i]}</small></th><td>{run.mentioned}개</td><td>{run.linked}개</td></tr>)}</tbody>
        </table>
        {review.added.length > 0 ? <>
          <h3>새로 등장한 질문 {review.added.length}개</h3>
          <p>이 중 {linked}개 답변에서 {review.host}를 우리 업체 설명에 직접 인용했어요.</p>
          <details className="launch-questions" open={printExpanded || undefined}><summary>실제 질문 보기</summary>
            <ul>{review.added.map(q => <li key={q.id}>
              {scope ? <button type="button" aria-expanded={selected === q.id} onClick={() => setSelected(selected === q.id ? null : q.id)}>
                <span>{q.text}</span><small>답변 {selected === q.id ? "접기" : "보기"}</small>
              </button> : <span>{q.text}</span>}
              {selected === q.id && scope && <DiagnosticQuestionAnswerPanel key={q.id} scope={{ ...scope, runId: after.id }} questionId={q.id} />}
            </li>)}</ul>
          </details>
        </> : <p>공개 후 새로 등장한 질문은 0개예요.</p>}
        <p className="launch-note">공개 전후에 관찰한 변화예요. {review.readoutChanged ? "답변 판독 방식이 달라 저장된 원문을 대조했어요." : "측정 시점에 따라 답변은 달라질 수 있어요."}</p>
      </div>
    </details>
  </section>;
}
