import { useState } from "react";
import { Check, ChevronRight, ExternalLink, Store } from "lucide-react";
import { Button } from "@/components/ui/button";
import { siteDisplayName, type repeatedPeerEvidence } from "@/lib/diagnostic-source-links";

type Peer = ReturnType<typeof repeatedPeerEvidence>[number];

function PeerSources({ peer, sourcesAvailable }: { peer: Peer; sourcesAvailable: boolean }) {
  return <section className="peer-source-panel" aria-label={`${peer.name} 등장 답변의 출처`}>
    <h3>{peer.name} 등장 답변의 출처</h3>
    {peer.sources.length ? <ul className="peer-source-list">{peer.sources.map(source => <li key={source.domain}>
      <div>{source.url ? <a href={source.url} target="_blank" rel="noopener noreferrer">{siteDisplayName(source.domain)}<ExternalLink aria-hidden="true" /><span className="sr-only">새 창에서 열기</span></a> : <strong>{siteDisplayName(source.domain)}</strong>}<span>함께 인용된 답변 {source.count}개</span></div>
    </li>)}</ul> : <p>{sourcesAvailable ? "이 업체와 연결된 출처는 확인되지 않았습니다." : "이 측정의 업체 출처 기록을 확인할 수 없습니다."}</p>}
  </section>;
}

export function RepeatedPeerEvidence({ rows, validCount, targetCount, sourcesAvailable, printExpanded = false }: {
  rows: Peer[]; validCount: number; targetCount: number; sourcesAvailable: boolean; printExpanded?: boolean;
}) {
  const [selectedName, setSelectedName] = useState<string | null>(() => rows[0]?.name ?? null);
  const selectedPeer = rows.find(peer => peer.name === selectedName) ?? rows[0] ?? null;
  const card = (peer: Peer) => {
    const active = selectedPeer?.name === peer.name;
    return <Button key={peer.name} variant="outline" className="peer-choice" aria-pressed={active} aria-controls="repeated-peer-source-panel" aria-label={`${peer.name} 등장 답변의 출처 보기, ${peer.responseCount}개 답변에 등장`} onClick={() => setSelectedName(peer.name)}>
      <span className="peer-choice-top"><Store aria-hidden="true" />{active ? <Check aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}</span>
      <span className="peer-choice-value"><strong>{peer.responseCount}</strong><small>개 답변에 등장</small></span>
      <span className="peer-choice-name">{peer.name}</span>
    </Button>;
  };

  return <section className="diagnostic-business-view mb-6" aria-label="전체 질문의 반복 등장 업체">
    <h2>전체 질문에서 두 번 이상 나온 업체</h2>
    <p className="diagnostic-state-note">유효 답변 {validCount}개 · 내 업체 {targetCount}회 등장 · 두 번 이상 나온 다른 업체 {rows.length}곳</p>
    {rows.length === 0 ? <p className="peer-empty">두 번 이상 확인된 다른 업체가 없습니다.</p> : <>
      <div className="peer-choice-grid no-print">{rows.slice(0, 4).map(card)}</div>
      {rows.length > 4 && <details className="peer-more no-print" open={printExpanded || undefined}><summary>다른 업체 {rows.length - 4}곳 더 보기</summary><div className="peer-choice-grid">{rows.slice(4).map(card)}</div></details>}
      {selectedPeer && <div id="repeated-peer-source-panel" className="no-print"><PeerSources peer={selectedPeer} sourcesAvailable={sourcesAvailable}/></div>}
      <div className="peer-print-list diagnostic-print-only">{rows.map(peer => <PeerSources key={peer.name} peer={peer} sourcesAvailable={sourcesAvailable}/>)}</div>
    </>}
  </section>;
}
