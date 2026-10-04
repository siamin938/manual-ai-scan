import { useEffect, useState } from "react";
import { createFileRoute, type SearchSchemaInput } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatSeoul } from "@/lib/format";
import {
  getMeasurementCreditAdminLedger,
  getMeasurementCreditAdminOverview,
  grantMeasurementCreditsAdmin,
  type CreditOrgDTO,
} from "@/lib/measurement-credit-admin.functions";

type MeasurementCreditsSearch = { org?: string };
type MeasurementCreditsSearchInput = SearchSchemaInput & { org?: string };

export const Route = createFileRoute("/_authenticated/measurement-credits")({
  validateSearch: (search: MeasurementCreditsSearchInput): MeasurementCreditsSearch => {
    const org = typeof search["org"] === "string" ? search["org"].trim() : "";
    return org ? { org } : {};
  },
  component: MeasurementCreditsPage,
  head: () => ({
    meta: [
      { title: "AI 노출 측정권 관리 | 차보임" },
      {
        name: "description",
        content: "차보임 내부 운영자가 조직별 AI 노출 측정권 잔액과 사용 내역을 확인하고 지급합니다.",
      },
      { property: "og:title", content: "AI 노출 측정권 관리 | 차보임" },
      {
        property: "og:description",
        content: "조직별 측정권 잔액, 누적 지급/사용 내역과 지급 기능을 제공합니다.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

const ORIGIN_LABELS: Record<CreditOrgDTO["dataOrigin"], string> = {
  internal_observation: "내부 관찰",
  customer_measurement: "고객 측정",
};

const ENTRY_LABELS: Record<string, string> = {
  admin_grant: "지급",
  measurement_debit: "측정 사용",
};

function entryLabel(type: string): string {
  return ENTRY_LABELS[type] ?? "기타";
}

function signed(amount: number): string {
  return `${amount >= 0 ? "+" : ""}${amount}`;
}

function newReferenceKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `grant-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function MeasurementCreditsPage() {
  const { org: requestedOrgId } = Route.useSearch();
  const queryClient = useQueryClient();
  const fetchOverview = useServerFn(getMeasurementCreditAdminOverview);
  const fetchLedger = useServerFn(getMeasurementCreditAdminLedger);
  const grantCredits = useServerFn(grantMeasurementCreditsAdmin);

  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);
  const [amount, setAmount] = useState("1");
  const [note, setNote] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setSearchQuery(searchInput.trim()), 400);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const overviewQuery = useQuery({
    queryKey: ["measurement-credit-admin-overview", searchQuery],
    queryFn: () => fetchOverview({ data: { query: searchQuery } }),
    placeholderData: (previousData) => previousData,
    retry: false,
  });

  const ledgerQuery = useQuery({
    queryKey: ["measurement-credit-admin-ledger", selectedOrgId],
    queryFn: () => fetchLedger({ data: { orgId: selectedOrgId as string } }),
    enabled: !!selectedOrgId,
    retry: false,
  });

  const mutation = useMutation({
    mutationFn: (vars: { orgId: string; amount: number; note: string }) =>
      grantCredits({
        data: {
          orgId: vars.orgId,
          amount: vars.amount,
          note: vars.note,
          referenceKey: newReferenceKey(),
        },
      }),
    onSuccess: (res, vars) => {
      setConfirmOpen(false);
      if (!res.ok) {
        toast.error("측정권을 지급하지 못했습니다. 잠시 후 다시 시도해 주세요.");
        return;
      }
      if (res.idempotent) {
        toast.success("이미 처리된 지급 요청입니다. 잔액을 다시 확인했습니다.");
      } else {
        toast.success(`측정권 ${vars.amount}회가 지급되었습니다.`);
      }
      setNote("");
      queryClient.invalidateQueries({ queryKey: ["measurement-credit-admin-overview"] });
      queryClient.invalidateQueries({
        queryKey: ["measurement-credit-admin-ledger", vars.orgId],
      });
    },
    onError: () => {
      setConfirmOpen(false);
      toast.error("측정권을 지급하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    },
  });

  if (overviewQuery.isPending && !overviewQuery.data) {
    return <p className="py-16 text-center text-sm text-muted-foreground">불러오는 중…</p>;
  }

  const overview = overviewQuery.data;
  if (!overview || !overview.ok) {
    return (
      <p className="py-16 text-center text-sm text-muted-foreground">
        이 화면을 볼 권한이 없습니다.
      </p>
    );
  }

  const orgs = overview.overview.organizations;

  useEffect(() => {
    if (!requestedOrgId || selectedOrgId) return;
    if (orgs.some((org) => org.orgId === requestedOrgId)) {
      setSelectedOrgId(requestedOrgId);
    }
  }, [requestedOrgId, selectedOrgId, orgs]);

  const selected = orgs.find((o) => o.orgId === selectedOrgId) ?? null;
  const parsedAmount = Number.parseInt(amount, 10);
  const amountValid = Number.isInteger(parsedAmount) && parsedAmount >= 1 && parsedAmount <= 100;

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold tracking-tight">AI 노출 측정권 관리</h1>
          <Badge variant="secondary">내부 운영자 전용</Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          내부 운영자가 조직별 측정권 잔액과 사용 내역을 확인하고, 필요한 경우 측정권을 지급합니다.
        </p>
        <p className="text-xs text-muted-foreground">
          기준 시각 {formatSeoul(overview.overview.generatedAt)}
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">조직 목록</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="조직명·가입자 이름·이메일 검색"
            />
            <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
              <p>
                {overviewQuery.isFetching && searchQuery
                  ? "검색 중…"
                  : searchQuery
                    ? `검색 결과 ${overview.overview.totalMatches}건`
                    : `총 ${overview.overview.totalMatches}개 조직`}
              </p>
              {overviewQuery.isFetching && (
                <span className="shrink-0" aria-live="polite">
                  결과 갱신 중
                </span>
              )}
            </div>
            {orgs.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {searchQuery ? "검색 결과가 없습니다." : "표시할 조직이 없습니다."}
              </p>
            ) : (
              orgs.map((o) => {
                const active = o.orgId === selectedOrgId;
                return (
                  <button
                    key={o.orgId}
                    type="button"
                    onClick={() => setSelectedOrgId(o.orgId)}
                    className={`w-full rounded-md border px-3 py-2 text-left transition-colors ${
                      active ? "border-primary bg-secondary" : "hover:bg-secondary"
                    }`}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{o.name}</span>
                      <Badge variant="outline">{ORIGIN_LABELS[o.dataOrigin]}</Badge>
                    </div>
                    {(o.ownerName || o.ownerEmail) && (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        대표 계정 {[o.ownerName, o.ownerEmail].filter(Boolean).join(" · ")}
                      </p>
                    )}
                    <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs text-muted-foreground sm:grid-cols-4">
                      <span className="tabular-nums">잔액 {o.balance}</span>
                      <span className="tabular-nums">누적 지급 {o.lifetimeGranted}</span>
                      <span className="tabular-nums">누적 사용 {o.lifetimeConsumed}</span>
                      <span className="tabular-nums">활성 업체 {o.clientBusinessCount}</span>
                    </div>
                  </button>
                );
              })
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">측정권 지급</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {!selected ? (
                <p className="text-sm text-muted-foreground">왼쪽에서 조직을 선택해 주세요.</p>
              ) : (
                <>
                  <p className="text-sm">
                    선택한 조직 <span className="font-medium">{selected.name}</span> · 현재 잔액{" "}
                    <span className="font-medium tabular-nums">{selected.balance}</span>
                  </p>
                  <div className="space-y-1.5">
                    <Label htmlFor="grant-amount">지급 수량 (1~100)</Label>
                    <Input
                      id="grant-amount"
                      type="number"
                      min={1}
                      max={100}
                      step={1}
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="grant-note">메모</Label>
                    <Input
                      id="grant-note"
                      value={note}
                      maxLength={300}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="지급 사유를 남겨 주세요"
                    />
                  </div>
                  <Button
                    disabled={!amountValid || mutation.isPending}
                    onClick={() => setConfirmOpen(true)}
                  >
                    측정권 지급
                  </Button>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">최근 사용 내역</CardTitle>
            </CardHeader>
            <CardContent>
              {!selected ? (
                <p className="text-sm text-muted-foreground">조직을 선택하면 내역이 표시됩니다.</p>
              ) : ledgerQuery.isLoading ? (
                <p className="text-sm text-muted-foreground">불러오는 중…</p>
              ) : !ledgerQuery.data || !ledgerQuery.data.ok ? (
                <p className="text-sm text-muted-foreground">내역을 불러오지 못했습니다.</p>
              ) : ledgerQuery.data.ledger.entries.length === 0 ? (
                <p className="text-sm text-muted-foreground">아직 내역이 없습니다.</p>
              ) : (
                <ul className="divide-y">
                  {ledgerQuery.data.ledger.entries.map((e) => (
                    <li key={e.id} className="flex items-start justify-between gap-3 py-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{entryLabel(e.entryType)}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatSeoul(e.createdAt)}
                          {e.note ? ` · ${e.note}` : ""}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-sm font-medium tabular-nums">{signed(e.amount)}</p>
                        <p className="text-xs text-muted-foreground tabular-nums">
                          잔액 {e.balanceAfter}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={confirmOpen} onOpenChange={(open) => !mutation.isPending && setConfirmOpen(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>측정권 지급 확인</DialogTitle>
            <DialogDescription>아래 내용으로 측정권을 지급합니다.</DialogDescription>
          </DialogHeader>
          {selected && amountValid && (
            <div className="space-y-1 text-sm">
              <p>
                조직 <span className="font-medium">{selected.name}</span>
              </p>
              <p className="tabular-nums">지급 수량 {parsedAmount}회</p>
              <p className="tabular-nums">
                지급 후 예상 잔액 {selected.balance + parsedAmount}
              </p>
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={mutation.isPending}
              onClick={() => setConfirmOpen(false)}
            >
              취소
            </Button>
            <Button
              disabled={!selected || !amountValid || mutation.isPending}
              onClick={() => {
                if (!selected || !amountValid) return;
                mutation.mutate({ orgId: selected.orgId, amount: parsedAmount, note });
              }}
            >
              {mutation.isPending ? "지급 중…" : "지급 확인"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
