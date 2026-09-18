import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { type ClientBusinessOptionDTO } from "@/lib/client-business-options.functions";
import { resolveSelectedBusinessId } from "@/lib/client-business-selection";
import { useActiveTargetBusiness } from "@/lib/active-business";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

export function useClientBusinessSelection(activeOrgId: string | null | undefined) {
  const shared = useActiveTargetBusiness();

  const query = useQuery({
    queryKey: ["client-business-options", activeOrgId],
    enabled: !!activeOrgId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("businesses")
        .select("id, name")
        .eq("org_id", activeOrgId as string)
        .eq("is_client_business", true)
        .eq("active", true)
        .order("name", { ascending: true });
      if (error) throw error;
      return { businesses: (data ?? []) as ClientBusinessOptionDTO[] };
    },
  });

  const options: ClientBusinessOptionDTO[] = useMemo(
    () => query.data?.businesses ?? [],
    [query.data],
  );

  // 저장된 선택값은 항상 현재 org의 유효한 대상 업체 목록과 대조한 뒤에만 사용한다.
  const selectedBusinessId = resolveSelectedBusinessId(
    activeOrgId,
    options,
    shared.getSelection(activeOrgId),
  );

  return {
    options,
    selectedBusinessId,
    isLoading: query.isLoading,
    isError: query.isError,
    select: (businessId: string) => {
      if (!activeOrgId) return;
      shared.select(activeOrgId, businessId);
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
  if (isLoading) return <Skeleton className="h-11 w-full sm:w-64" />;
  if (isError)
    return <p className="text-sm text-destructive">대상 업체 목록을 불러오지 못했습니다.</p>;
  if (options.length === 0) return null;

  return (
    <div className="flex w-full items-center gap-3 sm:w-auto">
      <span className="shrink-0 text-sm font-semibold text-foreground">대상 업체</span>
      <Select {...(value ? { value } : {})} onValueChange={onChange}>
        <SelectTrigger className="h-11 min-w-0 flex-1 border-input bg-card px-4 text-base shadow-none sm:w-64 sm:flex-none">
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
