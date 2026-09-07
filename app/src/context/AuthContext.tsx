import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { Account } from "../api/types";
import { getCurrentUser, signOut as apiSignOut } from "../api/auth";

interface AuthContextValue {
  user: Account | null;
  /** Call after api/auth.ts writes a new session (sign-in or password change)
   * so the rest of the app re-renders with the new identity. */
  refresh: () => void;
  signOut: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Account | null>(() => getCurrentUser());

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      refresh: () => setUser(getCurrentUser()),
      signOut: () => {
        apiSignOut();
        setUser(null);
      },
    }),
    [user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
