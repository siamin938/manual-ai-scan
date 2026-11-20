import { ExternalLink } from "lucide-react";
import { siteDisplayName, type repeatedPeerEvidence } from "@/lib/diagnostic-source-links";

type Peer = ReturnType<typeof repeatedPeerEvidence>[number];

function PeerRow({ peer, sourcesAvailable }: { peer: Peer; sourcesAvailable: boolean }) {
  return <li className="rounded-xl border bg-card p-4">
    <div className="flex items-baseline justify-between gap-3">
      <strong className="break-words">{peer.name}</strong>
      <strong className="shrink-0 text-primary">{peer.responseCount}회 등장</strong>
    </div>
    {peer.sources.length ? <ul className="mt-2 space-y-1 text-sm">
      {peer.sources.map(source => <li key={source.domain}>
        {source.url ? <a href={source.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-primary underline underline-offset-4">
          {siteDisplayName(source.domain)} <ExternalLink size={13} aria-label="새 창"/>
        </a> : siteDisplayName(source.domain)} <span className="text-muted-foreground">함께 인용된 답변 {source.count}개</span>
      </li>)}
    </ul> : <p className="mt-2 text-sm text-muted-foreground">{sourcesAvailable ? "이 업체와 연결된 출처는 확인되지 않았습니다." : "이 측정의 업체별 출처 기록을 확인할 수 없습니다."}</p>}
  </li>;
}

export function RepeatedPeerEvidence({ rows, validCount, targetCount, sourcesAvailable, printExpanded = false }: {
  rows: Peer[]; validCount: number; targetCount: number; sourcesAvailable: boolean; printExpanded?: boolean;
}) {
  return <section className="diagnostic-business-view mb-6" aria-label="전체 질문의 반복 등장 업체">
    <h2>전체 질문에서 두 번 이상 나온 업체</h2>
    <p className="diagnostic-state-note">유효 답변 {validCount}개 기준. 내 업체 {targetCount}회 등장, 두 번 이상 나온 다른 업체 {rows.length}곳.</p>
    {rows.length > 0 && <ul className="mt-3 grid gap-2 sm:grid-cols-2">{rows.slice(0, 4).map(peer => <PeerRow key={peer.name} peer={peer} sourcesAvailable={sourcesAvailable}/>)}</ul>}
    {rows.length > 4 && <details className="mt-3" open={printExpanded || undefined}>
      <summary className="cursor-pointer py-2 text-sm font-medium text-primary">다른 업체 {rows.length - 4}곳 더 보기</summary>
      <ul className="mt-2 grid gap-2 sm:grid-cols-2">{rows.slice(4).map(peer => <PeerRow key={peer.name} peer={peer} sourcesAvailable={sourcesAvailable}/>)}</ul>
    </details>}
  </section>;
}
