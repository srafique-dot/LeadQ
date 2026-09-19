import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { Account } from "../api/types";
import { getCurrentUser, signOut as apiSignOut, findAccount } from "../api/auth";

interface AuthContextValue {
  /** The account every screen should render as — the impersonated account
   * while a superadmin is "viewing as" someone, otherwise the real signed-in
   * account. */
  user: Account | null;
  /** The actual signed-in account, regardless of view-as. Only superadmin
   * tooling needs this. */
  realUser: Account | null;
  /** Set/clear who a superadmin is viewing the app as. Only meaningful when
   * realUser.role === 'superadmin' — other roles never call this. */
  viewAsId: string | null;
  setViewAs: (employeeId: string | null) => void;
  /** Call after api/auth.ts writes a new session (sign-in or password change)
   * so the rest of the app re-renders with the new identity. */
  refresh: () => void;
  signOut: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [realUser, setRealUser] = useState<Account | null>(() => getCurrentUser());
  const [viewAsId, setViewAsId] = useState<string | null>(null);

  const viewedAccount = viewAsId ? (findAccount(viewAsId) ?? null) : null;

  const value = useMemo<AuthContextValue>(
    () => ({
      user: viewedAccount ?? realUser,
      realUser,
      viewAsId,
      setViewAs: (employeeId) => setViewAsId(employeeId),
      refresh: () => setRealUser(getCurrentUser()),
      signOut: () => {
        apiSignOut();
        setViewAsId(null);
        setRealUser(null);
      },
    }),
    [realUser, viewAsId, viewedAccount],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
