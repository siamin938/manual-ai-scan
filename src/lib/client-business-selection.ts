/**
 * 대상 업체 선택 상태를 org에 묶어 관리하기 위한 순수 헬퍼.
 * org가 바뀐 직후 이전 org의 businessId가 쿼리에 쓰이는 것을 막는다.
 */
export type BusinessSelection = { orgId: string; businessId: string } | null;

/**
 * 현재 org와 옵션 목록을 기준으로 실제 사용할 businessId를 결정한다.
 * - selection이 없거나 org가 다르면 무시
 * - selection의 businessId가 현재 옵션에 없으면 무시
 * - 무시된 경우 목록의 첫 업체, 목록이 비어 있으면 null
 */
export function resolveSelectedBusinessId(
  activeOrgId: string | null | undefined,
  options: { id: string }[],
  selection: BusinessSelection,
): string | null {
  if (!activeOrgId) return null;
  if (
    selection &&
    selection.orgId === activeOrgId &&
    options.some((o) => o.id === selection.businessId)
  ) {
    return selection.businessId;
  }
  return options[0]?.id ?? null;
}
