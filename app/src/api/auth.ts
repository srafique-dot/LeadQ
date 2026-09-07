import type { Account, Role } from "./types";

/**
 * Mock auth for phase 1. Every function here is a stand-in for a future
 * HTTP call to the real backend (POST /auth/sign-in, POST /auth/change-password,
 * ...) — callers never touch localStorage directly, so swapping the bodies
 * below for `fetch` calls later won't touch any component.
 */

const ACCOUNTS_KEY = "umch.mock.accounts";
const SESSION_KEY = "umch.session";
const REMEMBERED_KEY = "umch.rememberedDevice";

const ROLE_LABEL: Record<Role, string> = {
  requester: "Business development",
  agent: "Call centre agent",
  admin: "Team lead",
  superadmin: "Superadmin",
};

// Matches the mock accounts baked into the Claude Design handoff so the two
// stay interchangeable during review (Outbound Queue - Sign in.dc.html).
const SEED_ACCOUNTS: Account[] = [
  { employeeId: "CC-002", name: "Nusrat Jahan", role: "agent", roleLabel: ROLE_LABEL.agent, password: "queue123", mustChangePassword: false },
  { employeeId: "CC-009", name: "Farhana Islam", role: "agent", roleLabel: ROLE_LABEL.agent, password: "Kf7-r2mq", mustChangePassword: true },
  { employeeId: "BD-007", name: "Ishrat Sultana", role: "requester", roleLabel: ROLE_LABEL.requester, password: "queue123", mustChangePassword: false },
  { employeeId: "OP-001", name: "Shahriar Kabir", role: "admin", roleLabel: ROLE_LABEL.admin, password: "queue123", mustChangePassword: false },
  { employeeId: "IT-001", name: "Sabbir Chowdhury", role: "superadmin", roleLabel: ROLE_LABEL.superadmin, password: "queue123", mustChangePassword: false },
];

function loadAccounts(): Account[] {
  try {
    const raw = localStorage.getItem(ACCOUNTS_KEY);
    if (raw) return JSON.parse(raw) as Account[];
  } catch {
    /* fall through to reseed */
  }
  localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(SEED_ACCOUNTS));
  return SEED_ACCOUNTS.slice();
}

function saveAccounts(accounts: Account[]) {
  localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
}

export function findAccount(employeeId: string): Account | undefined {
  const id = employeeId.trim().toUpperCase();
  return loadAccounts().find((a) => a.employeeId === id);
}

export function getRememberedEmployeeId(): string | null {
  return localStorage.getItem(REMEMBERED_KEY);
}

export function clearRememberedDevice() {
  localStorage.removeItem(REMEMBERED_KEY);
}

export type SignInError = "empty_id" | "unknown_id" | "empty_password" | "wrong_password";

export function signIn(
  employeeId: string,
  password: string,
  stayOnDevice: boolean,
): { ok: true; account: Account } | { ok: false; error: SignInError } {
  const id = employeeId.trim().toUpperCase();
  if (!id) return { ok: false, error: "empty_id" };
  const account = findAccount(id);
  if (!account) return { ok: false, error: "unknown_id" };
  if (!password) return { ok: false, error: "empty_password" };
  if (password !== account.password) return { ok: false, error: "wrong_password" };

  // The device always remembers *which* ID last signed in here (that's what
  // powers "Welcome back, {name}" on the next visit) — independent of
  // whether the session itself survives a browser restart.
  localStorage.setItem(REMEMBERED_KEY, account.employeeId);
  if (stayOnDevice) {
    localStorage.setItem(SESSION_KEY, account.employeeId);
    sessionStorage.removeItem(SESSION_KEY);
  } else {
    sessionStorage.setItem(SESSION_KEY, account.employeeId);
    localStorage.removeItem(SESSION_KEY);
  }
  return { ok: true, account };
}

export function setPassword(employeeId: string, newPassword: string, stayOnDevice: boolean) {
  const accounts = loadAccounts();
  const next = accounts.map((a) =>
    a.employeeId === employeeId ? { ...a, password: newPassword, mustChangePassword: false } : a,
  );
  saveAccounts(next);
  localStorage.setItem(REMEMBERED_KEY, employeeId);
  if (stayOnDevice) {
    localStorage.setItem(SESSION_KEY, employeeId);
    sessionStorage.removeItem(SESSION_KEY);
  } else {
    sessionStorage.setItem(SESSION_KEY, employeeId);
    localStorage.removeItem(SESSION_KEY);
  }
}

export function getCurrentUser(): Account | null {
  const id = sessionStorage.getItem(SESSION_KEY) ?? localStorage.getItem(SESSION_KEY);
  if (!id) return null;
  return findAccount(id) ?? null;
}

export function signOut() {
  sessionStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(SESSION_KEY);
}

export function landingPathFor(role: Role): string {
  switch (role) {
    case "requester":
      return "/leads";
    case "agent":
      return "/queue";
    case "admin":
      return "/floor";
    case "superadmin":
      return "/people";
  }
}
