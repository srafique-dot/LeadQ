import crypto from "node:crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { query } from "./_db.js";

export type Role = "requester" | "agent" | "admin" | "superadmin";

export interface Session {
  employeeId: string;
  name: string;
  role: Role;
  mustChangePassword: boolean;
}

const COOKIE = "leadq_session";
/** Unticked "stay signed in": a browser-session cookie, and the token itself
 * still dies after a long shift so a forgotten tab on a shared desk can't
 * be reused the next day. */
const SHORT_TTL_S = 12 * 60 * 60;
const LONG_TTL_S = 14 * 24 * 60 * 60;

/** SESSION_SECRET when set; otherwise derived from the database URL, which
 * is already a server-only secret in every environment this runs in. That
 * keeps a deploy from breaking before someone adds the variable, at the
 * cost of signing everyone out if the database password is rotated. */
function secret(): Buffer {
  const explicit = process.env.SESSION_SECRET;
  if (explicit && explicit.length >= 32) return Buffer.from(explicit);
  const db = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
  if (!db) throw new Error("No SESSION_SECRET or DATABASE_URL to sign sessions with.");
  return crypto.createHash("sha256").update("leadq-session-v1:" + db).digest();
}

function sign(payload: string): string {
  return crypto.createHmac("sha256", secret()).update(payload).digest("base64url");
}

/** `v` is the account's session_version at issue time. Bumping that column
 * (password reset, password change, deactivation) invalidates every token
 * already out there without needing a sessions table. */
function issueToken(employeeId: string, version: number, ttlS: number): string {
  const payload = Buffer.from(
    JSON.stringify({ sub: employeeId, v: version, exp: Math.floor(Date.now() / 1000) + ttlS }),
  ).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

function readToken(token: string): { sub: string; v: number } | null {
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const given = Buffer.from(sig);
  const expected = Buffer.from(sign(payload));
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  try {
    const { sub, v, exp } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (typeof sub !== "string" || typeof v !== "number" || typeof exp !== "number") return null;
    if (exp < Date.now() / 1000) return null;
    return { sub, v };
  } catch {
    return null;
  }
}

function readCookie(req: VercelRequest, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i === -1) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

function isLocal(req: VercelRequest): boolean {
  const host = String(req.headers.host ?? "");
  return host.startsWith("localhost") || host.startsWith("127.0.0.1");
}

export function setSessionCookie(req: VercelRequest, res: VercelResponse, employeeId: string, version: number, stay: boolean) {
  const ttl = stay ? LONG_TTL_S : SHORT_TTL_S;
  const parts = [`${COOKIE}=${issueToken(employeeId, version, ttl)}`, "Path=/", "HttpOnly", "SameSite=Lax"];
  if (!isLocal(req)) parts.push("Secure");
  if (stay) parts.push(`Max-Age=${ttl}`);
  res.setHeader("Set-Cookie", parts.join("; "));
}

export function clearSessionCookie(req: VercelRequest, res: VercelResponse) {
  const parts = [`${COOKIE}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (!isLocal(req)) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

/** Verifies the cookie and re-reads the account on every request, so
 * deactivating someone or resetting their password takes effect on their
 * very next click rather than whenever their token happens to expire. */
export async function loadSession(req: VercelRequest): Promise<Session | null> {
  const token = readCookie(req, COOKIE);
  if (!token) return null;
  const claims = readToken(token);
  if (!claims) return null;
  const { rows } = await query<{
    employee_id: string;
    name: string;
    role: Role;
    active: boolean;
    must_change_password: boolean;
    session_version: number;
  }>(
    "select employee_id, name, role, active, must_change_password, session_version from accounts where employee_id = $1",
    [claims.sub],
  );
  const a = rows[0];
  if (!a || !a.active || a.session_version !== claims.v) return null;
  return { employeeId: a.employee_id, name: a.name, role: a.role, mustChangePassword: a.must_change_password };
}

/** SameSite=Lax already stops other sites' POSTs from carrying the cookie;
 * this is the second lock on the same door. */
export function isCrossOrigin(req: VercelRequest): boolean {
  const origin = req.headers.origin;
  if (!origin) return false;
  try {
    return new URL(String(origin)).host !== req.headers.host;
  } catch {
    return true;
  }
}

/** Sends 403 and returns false when the session's role isn't one of `roles`. */
export function allow(res: VercelResponse, session: Session, ...roles: Role[]): boolean {
  if (roles.includes(session.role)) return true;
  res.status(403).json({ error: "forbidden" });
  return false;
}

export const isManager = (s: Session) => s.role === "admin" || s.role === "superadmin";
