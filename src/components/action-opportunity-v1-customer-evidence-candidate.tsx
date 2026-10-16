import { useState } from "react";
import type { V1CustomerEvidenceCandidate } from "@/lib/action-opportunity-v1.customer-release-candidate";

/**
 * Release-candidate component: mounted only inside the admin-only QA wrapper.
 * Never mount on customer routes without approval and real browser QA.
 */
export function ActionOpportunityV1CustomerEvidenceCandidate({
  detail,
  expandEvidence = false,
}: {
  detail: V1CustomerEvidenceCandidate;
  expandEvidence?: boolean | undefined;
}) {
  const [evidenceOpen, setEvidenceOpen] = useState(expandEvidence);
  return (
    <details
      className="group rounded-lg border bg-card"
      open={evidenceOpen}
      onToggle={(event) => setEvidenceOpen(event.currentTarget.open)}
    >
      <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold [&::-webkit-details-marker]:hidden">
        <span className="group-open:hidden">판단 근거 자세히 보기 ▾</span>
        <span className="hidden group-open:inline">판단 근거 접기 ▴</span>
      </summary>
      <div className="space-y-4 border-t px-4 py-4">
        <div>
          <p className="text-base font-semibold">{detail.title}</p>
          <p className="mt-3 text-sm font-semibold">무엇을 확인하면 될까요?</p>
          <p className="mt-1 text-sm leading-6">{detail.recommendedCheck}</p>
        </div>
        <div>
          <p className="text-sm font-semibold">이번 측정에서 확인된 사실</p>
          <p className="mt-1 text-sm leading-6">{detail.observation}</p>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            {detail.explanation}
          </p>
        </div>
        <dl className="space-y-2 rounded-lg bg-muted/40 p-3">
          {detail.evidence.map((row) => (
            <div key={row.label} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
              <dt className="text-muted-foreground">{row.label}</dt>
              <dd className="min-w-0 break-words font-medium">{row.value}</dd>
            </div>
          ))}
        </dl>
        <p className="text-xs leading-5 text-muted-foreground">{detail.disclaimer}</p>
      </div>
    </details>
  );
}
