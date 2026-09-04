import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatSeoul } from "@/lib/format";
import {
  getDataAssetAdminOverview,
  type DataAssetOriginDTO,
} from "@/lib/data-asset-admin.functions";

export const Route = createFileRoute("/_authenticated/data-assets")({
  component: DataAssetsPage,
  head: () => ({
    meta: [
      { title: "데이터 자산 현황 | 차보임" },
      {
        name: "description",
        content: "차보임 내부 운영자용 읽기 전용 데이터 자산 현황 화면입니다.",
      },
      { property: "og:title", content: "데이터 자산 현황 | 차보임" },
      {
        property: "og:description",
        content: "측정 데이터 원천과 최근 90일 벤치마크 포함 현황을 확인합니다.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

const ORIGIN_LABELS: Record<DataAssetOriginDTO["origin"], string> = {
  internal_observation: "내부 관찰 데이터",
  customer_measurement: "고객 측정 데이터",
  demo: "데모 데이터",
};

const ORIGIN_ORDER: DataAssetOriginDTO["origin"][] = [
  "internal_observation",
  "customer_measurement",
  "demo",
];

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  );
}

function DataAssetsPage() {
  const fetchOverview = useServerFn(getDataAssetAdminOverview);
  const { data, isLoading } = useQuery({
    queryKey: ["data-asset-admin-overview"],
    queryFn: () => fetchOverview({ data: undefined }),
    retry: false,
  });

  if (isLoading) {
    return <p className="py-16 text-center text-sm text-muted-foreground">불러오는 중…</p>;
  }

  if (!data || !data.ok) {
    return (
      <p className="py-16 text-center text-sm text-muted-foreground">
        이 화면을 볼 권한이 없습니다.
      </p>
    );
  }

  const { origins, benchmark90d, generatedAt } = data.overview;
  const byOrigin = new Map(origins.map((o) => [o.origin, o]));

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold tracking-tight">데이터 자산 현황</h1>
          <Badge variant="secondary">읽기 전용</Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          차보임이 축적한 측정 데이터가 어떤 원천에서 쌓이고, 최근 90일 벤치마크에 얼마나
          포함되는지 확인합니다.
        </p>
        <p className="text-xs text-muted-foreground">
          이 화면은 조회 전용이며 어떤 데이터도 변경하지 않습니다. 기준 시각 {formatSeoul(generatedAt)}
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-3">
        {ORIGIN_ORDER.map((key) => {
          const o = byOrigin.get(key);
          return (
            <Card key={key}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{ORIGIN_LABELS[key]}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1.5">
                {o ? (
                  <>
                    <Row label="현실 업체 수" value={`${o.realBusinessCount}`} />
                    <Row label="완료 Run" value={`${o.completedRunCount}`} />
                    <Row label="유효 AI 답변" value={`${o.validMeasurementCount}`} />
                    <Row label="조직 수" value={`${o.organizationCount}`} />
                    <Row label="최근 완료" value={formatSeoul(o.latestCompletedAt)} />
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">데이터 없음</p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">최근 90일 벤치마크</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5">
          <Row label="현실 업체 수" value={`${benchmark90d.realBusinessCount}`} />
          <Row label="eligible Run" value={`${benchmark90d.eligibleRunCount}`} />
          <Row label="포함 origin" value="내부 관찰 + 고객 측정" />
          <Row label="포함 origin 수" value={`${benchmark90d.contributingOriginCount}`} />
          <Row label="최근 측정" value={formatSeoul(benchmark90d.latestMeasuredAt)} />
          <Row
            label="business identity version"
            value={benchmark90d.businessIdentityVersion}
          />
          <p className="pt-2 text-xs text-muted-foreground">
            데모 데이터는 벤치마크 집계에서 제외됩니다.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
