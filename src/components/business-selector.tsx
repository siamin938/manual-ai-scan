import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  getClientBusinessOptions,
  type ClientBusinessOptionDTO,
} from "@/lib/client-business-options.functions";
import {
  resolveSelectedBusinessId,
  type BusinessSelection,
} from "@/lib/client-business-selection";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

export function useClientBusinessSelection(activeOrgId: string | null | undefined) {
  const fetchOptions = useServerFn(getClientBusinessOptions);
  const [selection, setSelection] = useState<BusinessSelection>(null);

  const query = useQuery({
    queryKey: ["client-business-options", activeOrgId],
    enabled: !!activeOrgId,
    queryFn: () => fetchOptions({ data: { orgId: activeOrgId as string } }),
  });

  const options: ClientBusinessOptionDTO[] = useMemo(
    () => query.data?.businesses ?? [],
    [query.data],
  );

  const selectedBusinessId = resolveSelectedBusinessId(activeOrgId, options, selection);

  return {
    options,
    selectedBusinessId,
    isLoading: query.isLoading,
    isError: query.isError,
    select: (businessId: string) => {
      if (!activeOrgId) return;
      setSelection({ orgId: activeOrgId, businessId });
    },
  };
}

export function BusinessSelector({
  options,
  value,
  onChange,
  isLoading,
  isError,
}: {
  options: ClientBusinessOptionDTO[];
  value: string | null;
  onChange: (businessId: string) => void;
  isLoading: boolean;
  isError: boolean;
}) {
  if (isLoading) return <Skeleton className="h-9 w-56" />;
  if (isError)
    return <p className="text-sm text-destructive">대상 업체 목록을 불러오지 못했습니다.</p>;
  if (options.length === 0) return null;

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground">대상 업체</span>
      <Select value={value ?? undefined} onValueChange={onChange}>
        <SelectTrigger className="w-56">
          <SelectValue placeholder="대상 업체 선택" />
        </SelectTrigger>
        <SelectContent>
          {options.map((b) => (
            <SelectItem key={b.id} value={b.id}>
              {b.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
