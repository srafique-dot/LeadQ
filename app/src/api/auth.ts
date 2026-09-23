import type { Account, Invite, Presence, Role } from "./types";

/**
 * Real backend calls. The session itself is an httpOnly cookie set by the
 * server, so nothing here can read or forge it. Only the "remembered on this
 * device" hint (name and ID for the sign-in screen) lives in localStorage.
 */

const REMEMBERED_KEY = "umch.rememberedDevice";
/** Fired on any 401 from the API so AuthContext can drop back to sign-in. */
export const UNAUTHENTICATED_EVENT = "leadq:unauthenticated";

let interceptorInstalled = false;
/** Wraps fetch once at startup: a session that expires or is revoked (password
 * reset, account deactivated) mid-shift sends the person to sign-in instead of
 * leaving every screen silently failing. */
export function installSessionInterceptor() {
  if (interceptorInstalled) return;
  interceptorInstalled = true;
  const original = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const res = await original(input, init);
    const url = typeof input === "string" ? input : input instanceof URL ? input.pathname : input.url;
    if (res.status === 401 && url.includes("/api/") && !url.includes("/api/auth")) {
      window.dispatchEvent(new Event(UNAUTHENTICATED_EVENT));
    }
    return res;
  };
}

interface RememberedAccount {
  employeeId: string;
  name: string;
  roleLabel: string;
}

export function getRememberedAccount(): RememberedAccount | null {
  try {
    const raw = localStorage.getItem(REMEMBERED_KEY);
    return raw ? (JSON.parse(raw) as RememberedAccount) : null;
  } catch {
    return null;
  }
}

export function clearRememberedDevice() {
  try {
    localStorage.removeItem(REMEMBERED_KEY);
  } catch {
    /* storage blocked */
  }
}

function rememberDevice(account: Account, stayOnDevice: boolean) {
  try {
    if (!stayOnDevice) return void localStorage.removeItem(REMEMBERED_KEY);
    const remembered: RememberedAccount = { employeeId: account.employeeId, name: account.name, roleLabel: account.roleLabel };
    localStorage.setItem(REMEMBERED_KEY, JSON.stringify(remembered));
  } catch {
    /* storage blocked */
  }
}

export type SignInError = "empty_id" | "unknown_id" | "empty_password" | "wrong_password" | "locked" | "network";

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
      body: JSON.stringify({ action: "sign-in", employeeId: id, password, stayOnDevice }),
    });
    json = await res.json();
  } catch {
    return { ok: false, error: "network" };
  }

  if (!json.ok || !json.account) return { ok: false, error: json.error ?? "network" };

  rememberDevice(json.account, stayOnDevice);
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
      body: JSON.stringify({ action: "change-password", newPassword, stayOnDevice }),
    });
    json = await res.json();
  } catch {
    return { ok: false, error: "network" };
  }
  if (!json.ok) return { ok: false, error: json.error ?? "network" };

  rememberDevice(account, stayOnDevice);
  return { ok: true };
}

/** Null when there's no valid session cookie (never signed in, expired, or
 * revoked). A network failure also lands here, as signed out. */
export async function getCurrentUser(): Promise<Account | null> {
  try {
    const res = await fetch("/api/auth");
    if (!res.ok) return null;
    return (await res.json()) as Account;
  } catch {
    return null;
  }
}

export async function signOut(): Promise<void> {
  try {
    await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "sign-out" }),
    });
  } catch {
    /* the cookie expires on its own */
  }
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
  /** Only meaningful for a requester invite — pre-fills their Add-lead form. */
  defaultChannel?: string;
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
      body: JSON.stringify({ ...input, stayOnDevice }),
    });
    json = await res.json();
    if (!res.ok) return { ok: false, error: (json as { error?: ClaimInviteError }).error ?? "network" };
  } catch {
    return { ok: false, error: "network" };
  }
  if (!json.account) return { ok: false, error: "network" };

  rememberDevice(json.account, stayOnDevice);
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

/** Agents declare their own availability. Going to break or signing off also
 * hands back any leads routed to them that they never actually called. */
export async function setPresence(employeeId: string, presence: Presence): Promise<void> {
  const res = await fetch(`/api/accounts/${employeeId}/presence`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ presence }),
  });
  if (!res.ok) throw new Error("Could not update availability");
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

/** Blank clears it — they go back to picking a channel on every lead. */
export async function setDefaultChannel(employeeId: string, defaultChannel: string): Promise<void> {
  const res = await fetch(`/api/accounts/${employeeId}/set-default-channel`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ defaultChannel }),
  });
  if (!res.ok) throw new Error("Could not update the default channel");
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
