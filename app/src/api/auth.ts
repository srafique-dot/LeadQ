import type { Account, Invite, Role } from "./types";

/**
 * Real backend calls. Every function here mirrors the shape the mock had in
 * phase 1 — callers already treat this as async-safe where it matters — so
 * this file is the only thing that changed to go from localStorage to the
 * live API.
 */

const SESSION_KEY = "umch.session";
const REMEMBERED_KEY = "umch.rememberedDevice";

interface RememberedAccount {
  employeeId: string;
  name: string;
  roleLabel: string;
}

export function getRememberedAccount(): RememberedAccount | null {
  const raw = localStorage.getItem(REMEMBERED_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as RememberedAccount;
  } catch {
    return null;
  }
}

export function clearRememberedDevice() {
  localStorage.removeItem(REMEMBERED_KEY);
}

function rememberDevice(account: Account) {
  const remembered: RememberedAccount = { employeeId: account.employeeId, name: account.name, roleLabel: account.roleLabel };
  localStorage.setItem(REMEMBERED_KEY, JSON.stringify(remembered));
}

function setSession(employeeId: string, stayOnDevice: boolean) {
  if (stayOnDevice) {
    localStorage.setItem(SESSION_KEY, employeeId);
    sessionStorage.removeItem(SESSION_KEY);
  } else {
    sessionStorage.setItem(SESSION_KEY, employeeId);
    localStorage.removeItem(SESSION_KEY);
  }
}

export type SignInError = "empty_id" | "unknown_id" | "empty_password" | "wrong_password" | "network";

export async function signIn(
  employeeId: string,
  password: string,
  stayOnDevice: boolean,
): Promise<{ ok: true; account: Account } | { ok: false; error: SignInError }> {
  const id = employeeId.trim().toUpperCase();
  if (!id) return { ok: false, error: "empty_id" };
  if (!password) return { ok: false, error: "empty_password" };

  let json: { ok: boolean; error?: SignInError; account?: Account };
  try {
    const res = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "sign-in", employeeId: id, password }),
    });
    json = await res.json();
  } catch {
    return { ok: false, error: "network" };
  }

  if (!json.ok || !json.account) return { ok: false, error: json.error ?? "network" };

  rememberDevice(json.account);
  setSession(json.account.employeeId, stayOnDevice);
  return { ok: true, account: json.account };
}

export type ChangePasswordError = "too_short" | "same_as_issued" | "network";

export async function setPassword(
  account: Account,
  newPassword: string,
  stayOnDevice: boolean,
): Promise<{ ok: true } | { ok: false; error: ChangePasswordError }> {
  let json: { ok: boolean; error?: ChangePasswordError };
  try {
    const res = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "change-password", employeeId: account.employeeId, newPassword }),
    });
    json = await res.json();
  } catch {
    return { ok: false, error: "network" };
  }
  if (!json.ok) return { ok: false, error: json.error ?? "network" };

  rememberDevice(account);
  setSession(account.employeeId, stayOnDevice);
  return { ok: true };
}

export async function getCurrentUser(): Promise<Account | null> {
  const id = sessionStorage.getItem(SESSION_KEY) ?? localStorage.getItem(SESSION_KEY);
  if (!id) return null;
  const accounts = await listAccounts();
  return accounts.find((a) => a.employeeId === id) ?? null;
}

export function signOut() {
  sessionStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(SESSION_KEY);
}

/** Unambiguous alphabet (no I/l/1/O/0), starts with a capital and a digit,
 * hyphen inserted for readability. Shown once, never retrievable. */
export function generatePassword(len = 8): string {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghijkmnopqrstuvwxyz";
  const digit = "23456789";
  const pool = upper + lower + digit;
  const pick = (s: string) => s[Math.floor(Math.random() * s.length)];
  let out = pick(upper) + pick(digit);
  while (out.length < Math.max(6, len)) out += pick(pool);
  out = out.slice(0, len);
  return out.slice(0, 4) + "-" + out.slice(4);
}

export function isValidEmployeeId(id: string): boolean {
  return /^[A-Za-z]{2,}_\d{2,6}$/.test(id.trim());
}

export function findAccountIn(accounts: Account[], employeeId: string): Account | undefined {
  const id = employeeId.trim().toUpperCase();
  return accounts.find((a) => a.employeeId === id);
}

export async function listAccounts(): Promise<Account[]> {
  const res = await fetch("/api/accounts");
  if (!res.ok) throw new Error("Could not load accounts");
  return res.json();
}

export interface NewInviteInput {
  role: Role;
  facility: string;
  callingNumber: string;
  createdBy: string;
}

/** Superadmin fixes role/facility/calling-number up front; the invitee fills
 * in their own name, EID, email and password when they open the link. */
export async function createInvite(input: NewInviteInput): Promise<Invite> {
  const res = await fetch("/api/invites", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "Could not create invite");
  return json;
}

export async function listInvites(): Promise<Invite[]> {
  const res = await fetch("/api/invites");
  if (!res.ok) throw new Error("Could not load invites");
  return res.json();
}

export interface InviteContext {
  role: Role;
  roleLabel: string;
  facility: string;
}

/** Public — no session needed. Returns null if the token is unknown or
 * already claimed. */
export async function getInviteContext(token: string): Promise<InviteContext | null> {
  const res = await fetch(`/api/invites/${token}`);
  if (!res.ok) return null;
  return res.json();
}

export type ClaimInviteError = "missing_name" | "too_short" | "invalid_id" | "invalid_token" | "already_used" | "id_taken" | "network";

export interface ClaimInviteInput {
  firstName: string;
  lastName: string;
  eid: string;
  email: string;
  password: string;
}

/** Public — the invitee sets their own password here, so unlike an
 * admin-created account there's no forced change afterward. Signs them in on
 * success, same as signIn. */
export async function claimInvite(
  token: string,
  input: ClaimInviteInput,
  stayOnDevice: boolean,
): Promise<{ ok: true; account: Account } | { ok: false; error: ClaimInviteError }> {
  let json: { ok: boolean; error?: ClaimInviteError; account?: Account };
  try {
    const res = await fetch(`/api/invites/${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    json = await res.json();
    if (!res.ok) return { ok: false, error: (json as { error?: ClaimInviteError }).error ?? "network" };
  } catch {
    return { ok: false, error: "network" };
  }
  if (!json.account) return { ok: false, error: "network" };

  rememberDevice(json.account);
  setSession(json.account.employeeId, stayOnDevice);
  return { ok: true, account: json.account };
}

/** Two-step reset: current password stops working immediately, a new one is
 * generated and shown once, and the account is forced to change it again. */
export async function resetPassword(employeeId: string): Promise<string> {
  const res = await fetch(`/api/accounts/${employeeId}/reset-password`, { method: "POST" });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "Could not reset password");
  return json.password;
}

/** Never deletes history — just blocks future sign-in. */
export async function setAccountActive(employeeId: string, active: boolean): Promise<void> {
  const res = await fetch(`/api/accounts/${employeeId}/toggle-active`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ active }),
  });
  if (!res.ok) throw new Error("Could not update access");
}

/** Employee ID stays permanent — only the display name changes. Works on
 * any account, including the superadmin's own. */
export async function renameAccount(employeeId: string, newName: string): Promise<void> {
  const res = await fetch(`/api/accounts/${employeeId}/rename`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: newName }),
  });
  if (!res.ok) throw new Error("Could not rename account");
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
