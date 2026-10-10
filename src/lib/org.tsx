import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export type AppRole = "owner" | "admin" | "analyst" | "client_viewer";

export type Membership = {
  org_id: string;
  role: AppRole;
  organizations: { id: string; name: string; slug: string; timezone: string } | null;
};

type OrgContextValue = {
  session: Session | null;
  memberships: Membership[];
  activeOrgId: string | null;
  setActiveOrgId: (id: string) => void;
  role: AppRole | null;
  canWrite: boolean;
  loading: boolean;
  refetch: () => void;
};

const OrgContext = createContext<OrgContextValue | null>(null);

export function useSession() {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      // Signing out in this or another tab must discard prior tenant/customer caches.
      if (event === "SIGNED_OUT") queryClient.clear();
      setSession(s);
    });
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    return () => sub.subscription.unsubscribe();
  }, [queryClient]);

  return { session, ready };
}

export function OrgProvider({ session, children }: { session: Session | null; children: ReactNode }) {
  const [activeOrgId, setActiveOrgId] = useState<string | null>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["memberships", session?.user.id],
    enabled: !!session,
    queryFn: async (): Promise<Membership[]> => {
      const { data, error } = await supabase
        .from("organization_members")
        .select("org_id, role, organizations(id, name, slug, timezone)")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as Membership[];
    },
  });

  const memberships = data ?? [];
  const effectiveOrgId =
    activeOrgId && memberships.some((m) => m.org_id === activeOrgId)
      ? activeOrgId
      : (memberships[0]?.org_id ?? null);
  const role = memberships.find((m) => m.org_id === effectiveOrgId)?.role ?? null;

  return (
    <OrgContext.Provider
      value={{
        session,
        memberships,
        activeOrgId: effectiveOrgId,
        setActiveOrgId,
        role,
        canWrite: role === "owner" || role === "admin" || role === "analyst",
        loading: isLoading,
        refetch,
      }}
    >
      {children}
    </OrgContext.Provider>
  );
}

export function useOrg() {
  const ctx = useContext(OrgContext);
  if (!ctx) throw new Error("useOrg must be used inside OrgProvider");
  return ctx;
}
