import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

/**
 * The active company, for every company-scoped query in the app.
 *
 * Context rather than localStorage on purpose. localStorage would be a second
 * source of truth that has to be kept in step with React state, and the two
 * drift in exactly the cases that matter: a switch mid-session leaves a window
 * where a component has re-rendered from state while another reads the old
 * value from storage, and a membership revoked in another tab leaves a stale
 * id sitting in storage that survives a reload. One value, held in one place,
 * derived fresh on every render, has neither problem.
 */

export interface CompanyMembership {
  companyId: string;
  name: string;
  role: string;
}

export type CompanyStatus =
  /** Session or membership list not resolved yet. Do not query, do not error. */
  | "loading"
  /** No signed-in user. ProtectedRoute handles the redirect; this just waits. */
  | "unauthenticated"
  /** At least one membership, and a valid company selected. */
  | "ready"
  /** Signed in, but a member of nothing. Every scoped page must stay blocked. */
  | "no-membership"
  /** The membership lookup itself failed. Fail closed, never fall through. */
  | "error";

export interface CompanyContextValue {
  status: CompanyStatus;
  /**
   * null means "no company is safely established". Pages MUST treat this as a
   * hard block and issue no query at all — never as "fetch without a filter",
   * which is precisely the leak this whole mechanism exists to prevent.
   */
  activeCompanyId: string | null;
  activeCompany: CompanyMembership | null;
  companies: CompanyMembership[];
  error: string | null;
  selectCompany: (companyId: string) => void;
  refresh: () => Promise<void>;
}

const CompanyContext = createContext<CompanyContextValue | null>(null);

/**
 * Membership is authoritative and comes from company_members, whose RLS lets a
 * user read only their own rows. Company names are cosmetic and come from a
 * second read; if that read returns nothing the switcher degrades to a
 * shortened id rather than the whole context failing, because a missing label
 * must never be able to block access the user actually has.
 */
async function fetchMemberships(userId: string): Promise<CompanyMembership[]> {
  const { data: rows, error } = await supabase
    .from("company_members")
    .select("company_id, role")
    .eq("user_id", userId);

  // Read .message off the object directly. supabase-js only wraps errors in a
  // class on the .throwOnError() path, so `error instanceof Error` is false
  // here and would discard a perfectly good message.
  if (error) throw new Error(error.message);

  const memberships = rows ?? [];
  if (memberships.length === 0) return [];

  const ids = memberships.map((row) => row.company_id);
  const { data: named } = await supabase
    .from("companies")
    .select("id, name")
    .in("id", ids);

  const nameById = new Map((named ?? []).map((row) => [row.id, row.name]));

  return memberships.map((row) => ({
    companyId: row.company_id,
    role: row.role,
    name: nameById.get(row.company_id) ?? `Company ${row.company_id.slice(0, 8)}`,
  }));
}

export function CompanyProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  const [status, setStatus] = useState<CompanyStatus>("loading");
  const [companies, setCompanies] = useState<CompanyMembership[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const aliveRef = useRef(true);
  const userIdRef = useRef<string | null>(null);

  /**
   * Monotonic request id, so only the newest load() may write state.
   *
   * load() can be in flight more than once: a focus event and an auth event
   * can overlap, and each run makes two sequential round trips (getSession,
   * then the membership query), which is ample room to resolve out of order.
   * Without this, a slow earlier run finishing last would reinstate the
   * membership list it fetched — and for a user whose access was just revoked,
   * that means silently restoring it.
   */
  const requestIdRef = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    const isCurrent = () => aliveRef.current && requestIdRef.current === requestId;

    const { data: sessionData } = await supabase.auth.getSession();
    if (!isCurrent()) return;
    const session = sessionData.session;

    if (!session) {
      userIdRef.current = null;
      setCompanies([]);
      setSelectedId(null);
      setError(null);
      setStatus("unauthenticated");
      return;
    }

    // A different user on the same tab must never inherit a selection.
    if (userIdRef.current !== null && userIdRef.current !== session.user.id) {
      setSelectedId(null);
    }
    userIdRef.current = session.user.id;

    try {
      const list = await fetchMemberships(session.user.id);
      if (!isCurrent()) return;
      setCompanies(list);
      setError(null);
      setStatus(list.length === 0 ? "no-membership" : "ready");
    } catch (cause) {
      if (!isCurrent()) return;
      // Fail closed: drop the list so activeCompanyId derives to null and every
      // scoped page blocks. An unreadable membership list is not permission.
      setCompanies([]);
      setError(cause instanceof Error ? cause.message : String(cause));
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    aliveRef.current = true;

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => {
      // Deferred: calling back into supabase-js from inside this callback can
      // deadlock its internal lock. The zero-delay timeout gets us onto a
      // clean tick.
      setTimeout(() => {
        void load();
      }, 0);
    });

    void load();

    // A membership revoked elsewhere is invisible until something re-reads it.
    // Re-checking when the tab regains focus is what turns "revoked" into
    // "blocked" within seconds rather than at the next full reload.
    const onFocus = () => {
      void load();
    };
    window.addEventListener("focus", onFocus);

    return () => {
      aliveRef.current = false;
      subscription.unsubscribe();
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

  /**
   * Derived on every render, never stored.
   *
   * This is the re-validation. Because the active id is recomputed from
   * (selection, memberships) rather than held independently, a company that
   * leaves the membership list takes the selection with it in the same render
   * that the list updates. There is no window in which a revoked company is
   * still active, and no effect that has to remember to clean it up.
   */
  const activeCompanyId = useMemo(() => {
    if (selectedId === null) return null;
    return companies.some((company) => company.companyId === selectedId) ? selectedId : null;
  }, [selectedId, companies]);

  const activeCompany = useMemo(
    () => companies.find((company) => company.companyId === activeCompanyId) ?? null,
    [companies, activeCompanyId],
  );

  // Auto-select only when there is no valid selection and no ambiguity. This
  // covers both first load for a single-company user and the case where
  // revocation leaves exactly one company standing — the same code path in
  // both, so the multi-company behaviour is never a separate, untested branch.
  useEffect(() => {
    if (status !== "ready") return;
    if (activeCompanyId === null && companies.length === 1) {
      setSelectedId(companies[0].companyId);
    }
  }, [status, activeCompanyId, companies]);

  // Switching company must not leave the previous company's rows on screen.
  // 21 pages read through react-query, which serves from cache by query key,
  // so remounting alone would re-render the same cached rows under a new
  // company. Clearing is the only thing that reliably empties it.
  const previousActiveRef = useRef<string | null>(null);
  useEffect(() => {
    const previous = previousActiveRef.current;
    previousActiveRef.current = activeCompanyId;
    if (previous !== null && previous !== activeCompanyId) {
      queryClient.clear();
    }
  }, [activeCompanyId, queryClient]);

  const selectCompany = useCallback(
    (companyId: string) => {
      // Verified against the membership list rather than trusted. Even if this
      // were bypassed the derivation above would reject it, but refusing here
      // keeps the rejection visible instead of silent.
      setSelectedId((previous) =>
        companies.some((company) => company.companyId === companyId) ? companyId : previous,
      );
    },
    [companies],
  );

  const value = useMemo<CompanyContextValue>(
    () => ({
      status,
      activeCompanyId,
      activeCompany,
      companies,
      error,
      selectCompany,
      refresh: load,
    }),
    [status, activeCompanyId, activeCompany, companies, error, selectCompany, load],
  );

  return <CompanyContext.Provider value={value}>{children}</CompanyContext.Provider>;
}

export function useCompany(): CompanyContextValue {
  const context = useContext(CompanyContext);
  if (context === null) {
    throw new Error("useCompany must be used inside a <CompanyProvider>");
  }
  return context;
}

/** Convenience for the common case. null means block, never "query unfiltered". */
export function useActiveCompanyId(): string | null {
  return useCompany().activeCompanyId;
}

/**
 * Wrapper for any page that reads a company-scoped table. Renders its children
 * only once a company is genuinely established, so a page cannot accidentally
 * run a query during the window where the id is still null.
 */
export function RequireCompany({ children }: { children: ReactNode }) {
  const { status, activeCompanyId, companies, error } = useCompany();

  if (activeCompanyId !== null) {
    return <>{children}</>;
  }

  if (status === "loading" || status === "unauthenticated") {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const message =
    status === "error"
      ? error ?? "Could not confirm which company you have access to."
      : status === "no-membership"
        ? "Your account is not a member of any company. Ask an administrator to add you."
        : companies.length > 1
          ? "Choose a company from the switcher to continue."
          : "Your access to this company has changed. Pick a company to continue.";

  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center gap-2 p-6 text-center">
      <p className="text-sm font-medium text-foreground">No company selected</p>
      <p className="max-w-md text-sm text-muted-foreground">{message}</p>
    </div>
  );
}
