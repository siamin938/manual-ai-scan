import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import {
  clearStoredTargetBusinessSelections,
  shouldDiscardCustomerState,
} from "@/lib/session-privacy";

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
    let disposed = false;
    let eventRevision = 0;
    let previousUserId: string | null = null;

    const acceptSession = (event: string, nextSession: Session | null) => {
      if (disposed) return;
      const nextUserId = nextSession?.user.id ?? null;

      if (shouldDiscardCustomerState(event, previousUserId, nextUserId)) {
        // Clear tenant data before updating the visible identity. A new user
        // must never inherit the previous user's React Query result cache.
        queryClient.clear();
        if (typeof window !== "undefined") {
          try {
            clearStoredTargetBusinessSelections(window.localStorage);
          } catch {
            // Disabled storage must never prevent logging out.
          }
        }
      }

      previousUserId = nextUserId;
      setSession(nextSession);
    };

    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      eventRevision += 1;
      acceptSession(event, s);
    });

    // The initial read may finish AFTER an auth event in another tab. Never
    // reapply that older session over an already-observed SIGNED_OUT/IN event.
    const initialRevision = eventRevision;
    void supabase.auth.getSession().then(({ data }) => {
      if (disposed) return;
      if (eventRevision === initialRevision) {
        acceptSession("INITIAL_READ", data.session);
      }
      setReady(true);
    }).catch(() => {
      if (!disposed) setReady(true);
    });

    return () => {
      disposed = true;
      sub.subscription.unsubscribe();
    };
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
