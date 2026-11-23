import type { V1CustomerEvidenceCandidate } from "@/lib/action-opportunity-v1.customer-release-candidate";

/**
 * Read-only, customer-facing CONTENT candidate mounted only by the authorized
 * admin QA drilldown. The parent owns the single expand/collapse control.
 *
 * The owner's check/recommendation already appears above the button in the
 * unchanged compact summary, so do not repeat it inside the expanded evidence.
 * This is not a customer release or an independent server-data consumer.
 */
export function ActionOpportunityV1CustomerEvidenceCandidate({
  detail,
}: {
  detail: V1CustomerEvidenceCandidate;
}) {
  return (
    <div
      role="region"
      aria-label="이번 측정 판단 근거"
      className="space-y-3 rounded-lg border bg-card px-4 py-4"
    >
      <div className="space-y-1">
        <p className="text-sm font-semibold">이번 측정에서 확인된 사실</p>
        <p className="text-sm leading-6">{detail.observation}</p>
        {detail.explanation.trim() !== detail.observation.trim() && (
          <p className="text-sm leading-6 text-muted-foreground">{detail.explanation}</p>
        )}
      </div>
      <div className="space-y-2">
        <p className="text-sm font-semibold">판단 근거</p>
        <dl className="space-y-2 rounded-lg bg-muted/40 p-3">
          {detail.evidence.map((row) => (
            <div key={row.label} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
              <dt className="text-muted-foreground">{row.label}</dt>
              <dd className="min-w-0 break-words font-medium">{row.value}</dd>
            </div>
          ))}
        </dl>
      </div>
      <p className="text-xs leading-5 text-muted-foreground">{detail.disclaimer}</p>
    </div>
  );
}
