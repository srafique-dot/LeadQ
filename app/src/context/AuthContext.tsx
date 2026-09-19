import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Account } from "../api/types";
import { getCurrentUser, signOut as apiSignOut, listAccounts, findAccountIn } from "../api/auth";

interface AuthContextValue {
  /** The account every screen should render as — the impersonated account
   * while a superadmin is "viewing as" someone, otherwise the real signed-in
   * account. */
  user: Account | null;
  /** The actual signed-in account, regardless of view-as. Only superadmin
   * tooling needs this. */
  realUser: Account | null;
  /** True until the initial session check resolves — lets App.tsx avoid
   * flashing the sign-in screen for someone who's already signed in. */
  loading: boolean;
  /** Every account on the roster, cached here so screens (Users, Supervisor's
   * agent list, superadmin's "view as" picker) don't each re-fetch it. */
  accounts: Account[];
  refreshAccounts: () => Promise<void>;
  /** Set/clear who a superadmin is viewing the app as. Only meaningful when
   * realUser.role === 'superadmin' — other roles never call this. */
  viewAsId: string | null;
  setViewAs: (employeeId: string | null) => void;
  /** Call after api/auth.ts writes a new session (sign-in or password change)
   * so the rest of the app re-renders with the new identity. */
  refresh: () => Promise<void>;
  signOut: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [realUser, setRealUser] = useState<Account | null>(null);
  const [loading, setLoading] = useState(true);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [viewAsId, setViewAsId] = useState<string | null>(null);

  async function refresh() {
    const account = await getCurrentUser();
    setRealUser(account);
  }

  async function refreshAccounts() {
    const list = await listAccounts();
    setAccounts(list);
  }

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (realUser) refreshAccounts();
    else setAccounts([]);
  }, [realUser?.employeeId]);

  const viewedAccount = viewAsId ? (findAccountIn(accounts, viewAsId) ?? null) : null;

  const value = useMemo<AuthContextValue>(
    () => ({
      user: viewedAccount ?? realUser,
      realUser,
      loading,
      accounts,
      refreshAccounts,
      viewAsId,
      setViewAs: (employeeId) => setViewAsId(employeeId),
      refresh,
      signOut: () => {
        apiSignOut();
        setViewAsId(null);
        setRealUser(null);
      },
    }),
    [realUser, loading, accounts, viewAsId, viewedAccount],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
