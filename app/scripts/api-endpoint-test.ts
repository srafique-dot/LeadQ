/**
 * Endpoint and security test against a real Postgres.
 *
 * Calls the shipped api/* handlers directly with mock request/response
 * objects, so auth, role checks and SQL are all the production code. Point
 * DATABASE_URL at a throwaway database loaded with db/schema.sql.
 */
import bcrypt from "bcryptjs";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { query, pool } from "../api/_db.js";
import auth from "../api/auth.js";
import accounts from "../api/accounts/index.js";
import accountAction from "../api/accounts/[id]/[action].js";
import leads from "../api/leads/index.js";
import leadAction from "../api/leads/[id]/[action].js";
import cdr from "../api/cdr/[monthKey].js";
import stats from "../api/supervisor/stats.js";
import invites from "../api/invites/index.js";
import claimInvite from "../api/invites/[token].js";
import channels from "../api/channels/index.js";

type Handler = (req: VercelRequest, res: VercelResponse) => Promise<void>;

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

interface Result {
  status: number;
  json: any;
  cookie: string | null;
  rawCookie: string;
}

async function call(
  handler: Handler,
  opts: { method?: string; query?: Record<string, string>; body?: unknown; cookie?: string | null; origin?: string },
): Promise<Result> {
  const headers: Record<string, string> = { host: "leadq.example.com" };
  if (opts.cookie) headers.cookie = opts.cookie;
  if (opts.origin) headers.origin = opts.origin;
  const req = { method: opts.method ?? "GET", query: opts.query ?? {}, body: opts.body, headers } as unknown as VercelRequest;
  const out: Result = { status: 200, json: undefined, cookie: null, rawCookie: "" };
  const res = {
    status(code: number) {
      out.status = code;
      return res;
    },
    json(v: unknown) {
      out.json = v;
      return res;
    },
    setHeader(name: string, v: string) {
      if (name.toLowerCase() === "set-cookie") {
        out.cookie = v.split(";")[0];
        out.rawCookie = v;
      }
      return res;
    },
  } as unknown as VercelResponse;
  await handler(req, res);
  return out;
}

async function signIn(id: string, password: string) {
  return call(auth as Handler, { method: "POST", body: { action: "sign-in", employeeId: id, password } });
}

async function setup() {
  await query("truncate dispositions, lead_entries, leads, invites, cdr_rows, cdr_uploads, cohorts, accounts cascade");
  const hash = await bcrypt.hash("correct-horse", 4);
  await query(
    `insert into accounts (employee_id, name, role, password_hash, must_change_password, calling_number) values
       ('SUPER_001', 'Super Admin', 'superadmin', $1, false, ''),
       ('LEAD_002', 'Team Lead', 'admin', $1, false, ''),
       ('AGENT_003', 'Agent Three', 'agent', $1, false, '301'),
       ('AGENT_004', 'Agent Four', 'agent', $1, false, '302'),
       ('REQ_005', 'Req Five', 'requester', $1, false, ''),
       ('REQ_006', 'Req Six', 'requester', $1, false, ''),
       ('NEW_007', 'New Person', 'agent', $1, true, '')`,
    [hash],
  );
}

async function main() {
  await setup();
  const L = leads as Handler;
  const LA = leadAction as Handler;

  console.log("\nUnauthenticated access is refused");
  for (const [name, h, q] of [
    ["accounts", accounts, {}],
    ["leads", leads, {}],
    ["supervisor stats", stats, {}],
    ["invites", invites, {}],
    ["cdr", cdr, { monthKey: "2026-09" }],
  ] as const) {
    const r = await call(h as Handler, { query: q as Record<string, string> });
    check(`${name} → 401`, r.status === 401, String(r.status));
  }
  const unauthReset = await call(accountAction as Handler, { method: "POST", query: { id: "SUPER_001", action: "reset-password" } });
  check("password reset without a session → 401", unauthReset.status === 401, String(unauthReset.status));
  const unauthChange = await call(auth as Handler, { method: "POST", body: { action: "change-password", employeeId: "SUPER_001", newPassword: "hijacked-pass" } });
  check("change-password without a session → 401", unauthChange.status === 401, String(unauthChange.status));

  console.log("\nSign-in");
  const bad = await signIn("AGENT_003", "nope");
  check("wrong password refused", bad.status === 400 && bad.json.error === "wrong_password");
  const unknown = await signIn("GHOST_999", "whatever");
  check("unknown ID refused", unknown.json.error === "unknown_id");
  const agent = await signIn("agent_003", "correct-horse");
  check("correct password signs in (ID case-insensitive)", agent.status === 200 && agent.json.ok && !!agent.cookie);
  check("cookie is HttpOnly, Secure, SameSite=Lax", /HttpOnly/.test(agent.rawCookie) && /Secure/.test(agent.rawCookie) && /SameSite=Lax/.test(agent.rawCookie), agent.rawCookie.replace(/=[^;]+/, "=…"));
  const agentCookie = agent.cookie!;
  const me = await call(auth as Handler, { cookie: agentCookie });
  check("GET /api/auth returns the signed-in account", me.json?.employeeId === "AGENT_003");

  console.log("\nTampered or forged tokens are rejected");
  const [payload, sig] = agentCookie.split("=")[1].split(".");
  const forgedPayload = Buffer.from(JSON.stringify({ sub: "SUPER_001", v: 0, exp: 9999999999 })).toString("base64url");
  const forged = await call(accounts as Handler, { cookie: `leadq_session=${forgedPayload}.${sig}` });
  check("payload swapped to superadmin → 401", forged.status === 401, String(forged.status));
  const garbage = await call(accounts as Handler, { cookie: `leadq_session=${payload}.AAAA` });
  check("bad signature → 401", garbage.status === 401, String(garbage.status));

  console.log("\nLockout after 5 wrong passwords");
  for (let i = 0; i < 5; i++) await signIn("AGENT_004", "wrong");
  const locked = await signIn("AGENT_004", "correct-horse");
  check("6th attempt with the right password is locked", locked.status === 429 && locked.json.error === "locked", String(locked.status));
  await query("update accounts set locked_until = now() - interval '1 minute' where employee_id = 'AGENT_004'");
  const unlocked = await signIn("AGENT_004", "correct-horse");
  check("sign-in works again once the lock lapses", unlocked.status === 200);
  const { rows: fl } = await query<{ failed_logins: number }>("select failed_logins from accounts where employee_id = 'AGENT_004'");
  check("counter resets after a good sign-in", fl[0].failed_logins === 0);
  const agent4Cookie = unlocked.cookie!;

  console.log("\nRole checks");
  const superCookie = (await signIn("SUPER_001", "correct-horse")).cookie!;
  const leadCookie = (await signIn("LEAD_002", "correct-horse")).cookie!;
  const reqCookie = (await signIn("REQ_005", "correct-horse")).cookie!;
  const req6Cookie = (await signIn("REQ_006", "correct-horse")).cookie!;
  const agentReset = await call(accountAction as Handler, { method: "POST", query: { id: "SUPER_001", action: "reset-password" }, cookie: agentCookie });
  check("agent cannot reset passwords → 403", agentReset.status === 403);
  const leadReset = await call(accountAction as Handler, { method: "POST", query: { id: "AGENT_003", action: "reset-password" }, cookie: leadCookie });
  check("team lead cannot reset passwords → 403", leadReset.status === 403);
  const agentStats = await call(stats as Handler, { cookie: agentCookie });
  check("agent cannot read supervisor stats → 403", agentStats.status === 403);
  const leadStats = await call(stats as Handler, { cookie: leadCookie });
  check("team lead can read supervisor stats", leadStats.status === 200);
  const agentInvite = await call(invites as Handler, { method: "POST", body: { role: "superadmin" }, cookie: agentCookie });
  check("agent cannot create an invite → 403", agentInvite.status === 403);
  const leadChannel = await call(channels as Handler, { method: "POST", body: { action: "create", name: "X" }, cookie: leadCookie });
  check("team lead cannot change channels → 403", leadChannel.status === 403);
  const otherPresence = await call(accountAction as Handler, { method: "POST", query: { id: "AGENT_004", action: "presence" }, body: { presence: "off" }, cookie: agentCookie });
  check("agent cannot set someone else's presence → 403", otherPresence.status === 403);
  const selfDeactivate = await call(accountAction as Handler, { method: "POST", query: { id: "SUPER_001", action: "toggle-active" }, body: { active: false }, cookie: superCookie });
  check("superadmin cannot deactivate themselves", selfDeactivate.status === 400);

  console.log("\nCross-origin writes are refused");
  const xo = await call(LA, { method: "POST", query: { id: "L-X", action: "claim" }, cookie: agentCookie, origin: "https://evil.example" });
  check("POST with a foreign Origin → 403", xo.status === 403 && xo.json.error === "cross_origin");

  console.log("\nForced password change");
  const fresh = await signIn("NEW_007", "correct-horse");
  check("temp-password account can sign in", fresh.status === 200 && fresh.json.account.mustChangePassword === true);
  const blocked = await call(L, { query: { queue: "1", agentId: "NEW_007" }, cookie: fresh.cookie });
  check("…but every other endpoint says password_change_required", blocked.status === 403 && blocked.json.error === "password_change_required");
  const weak = await call(auth as Handler, { method: "POST", body: { action: "change-password", newPassword: "short" }, cookie: fresh.cookie });
  check("short new password refused", weak.json.error === "too_short");
  const changed = await call(auth as Handler, { method: "POST", body: { action: "change-password", newPassword: "a-much-better-one", employeeId: "SUPER_001" }, cookie: fresh.cookie });
  check("change-password succeeds and re-issues the cookie", changed.status === 200 && !!changed.cookie);
  const { rows: pw } = await query<{ employee_id: string; must_change_password: boolean }>(
    "select employee_id, must_change_password from accounts where employee_id in ('NEW_007','SUPER_001') order by employee_id",
  );
  check("only the caller's own password changed (body employeeId ignored)", pw.find((r) => r.employee_id === "NEW_007")!.must_change_password === false);
  const oldCookieAfterChange = await call(accounts as Handler, { cookie: fresh.cookie });
  check("the pre-change cookie no longer works", oldCookieAfterChange.status === 401);
  const newCookieWorks = await call(accounts as Handler, { cookie: changed.cookie });
  check("the re-issued cookie works", newCookieWorks.status === 200);
  const superStill = await signIn("SUPER_001", "correct-horse");
  check("superadmin's password untouched", superStill.status === 200);

  console.log("\nLead creation, phone normalisation and requester scoping");
  const created = await call(L, { method: "POST", body: { name: "Rahim Uddin", phone: "017 1234-5678", ownerId: "SUPER_001", ownerName: "Spoof" }, cookie: reqCookie });
  check("requester creates a lead", created.status === 201, String(created.status));
  check("owner comes from the session, not the body", created.json.ownerId === "REQ_005");
  check("lead ID is 10 hex chars", /^L-[0-9A-F]{10}$/.test(created.json.id), created.json.id);
  const dupe = await call(L, { query: { phone: "+8801712345678" }, cookie: agentCookie });
  check("same number written differently is found as the same lead", dupe.json?.id === created.json.id);
  const badPhone = await call(L, { method: "POST", body: { name: "No Phone", phone: "12" }, cookie: reqCookie });
  check("a lead without a usable phone is refused", badPhone.status === 400);
  const otherReq = await call(L, { query: { ownerId: "REQ_005" }, cookie: req6Cookie });
  check("a requester asking for someone else's leads gets only their own", Array.isArray(otherReq.json) && otherReq.json.length === 0);
  const reqAll = await call(L, { cookie: reqCookie });
  check("requester cannot list every lead → 403", reqAll.status === 403);
  const reqSearch = await call(L, { query: { search: "rahim" }, cookie: reqCookie });
  check("requester cannot search every lead → 403", reqSearch.status === 403);
  const agentSearch = await call(L, { query: { search: "rahim" }, cookie: agentCookie });
  check("agent search finds by name", agentSearch.json?.[0]?.id === created.json.id);
  const agentSearchPhone = await call(L, { query: { search: "12345678" }, cookie: agentCookie });
  check("agent search finds by phone digits", agentSearchPhone.json?.[0]?.id === created.json.id);
  const reqById = await call(L, { query: { id: created.json.id }, cookie: req6Cookie });
  check("a requester can't open another requester's lead by ID", reqById.status === 404);

  console.log("\nImport: dedupe and bulk insert");
  const rows = Array.from({ length: 3000 }, (_, i) => ({
    name: `Import ${i}`,
    phone: `0181${String(i).padStart(7, "0")}`,
    facility: "", doctor: "", department: "", email: "", note: "", leadType: "general_inquiry",
    wantDate: "", preferredTime: "", urgent: false, urgentReason: "",
  }));
  rows.push({ ...rows[0], name: "Same number again" });
  rows.push({ ...rows[1], name: "Rahim again", phone: "01712345678" });
  rows.push({ ...rows[2], name: "", phone: "01800000000" });
  const t0 = Date.now();
  const imp = await call(L, { method: "POST", query: { action: "import" }, body: { rows, cohort: "Test cohort" }, cookie: reqCookie });
  const ms = Date.now() - t0;
  check("3,003-row import completes", imp.status === 200, `${ms} ms`);
  check("3,000 new leads created", imp.json.created?.length === 3000, String(imp.json.created?.length));
  check("duplicate in file and duplicate in DB both caught", imp.json.duplicates?.length === 2, String(imp.json.duplicates?.length));
  check("nameless row skipped and reported", imp.json.skipped === 1);
  const tooMany = await call(L, { method: "POST", query: { action: "import" }, body: { rows: Array(5001).fill(rows[0]), cohort: "X" }, cookie: reqCookie });
  check("over 5,000 rows refused with 413", tooMany.status === 413);

  console.log("\nAgent flow: queue, claim, disposition, retry ladder");
  await call(accountAction as Handler, { method: "POST", query: { id: "AGENT_003", action: "presence" }, body: { presence: "available" }, cookie: agentCookie });
  const q = await call(L, { query: { queue: "1", agentId: "AGENT_004" }, cookie: agentCookie });
  check("agent asking for another agent's queue gets their own", q.status === 200 && q.json.every((l: any) => l.assignedTo === "AGENT_003" || l.assignedTo !== "AGENT_004"));
  const first = q.json[0];
  const noClaim = await call(LA, { method: "POST", query: { id: first.id, action: "disposition" }, body: { l1: "busy", l2: null }, cookie: agentCookie });
  check("disposition without holding the claim → 409", noClaim.status === 409 && noClaim.json.error === "not_your_claim");
  const claim = await call(LA, { method: "POST", query: { id: first.id, action: "claim" }, cookie: agentCookie });
  check("claim with an empty POST body works", claim.status === 200, String(claim.status));
  const steal = await call(LA, { method: "POST", query: { id: first.id, action: "claim" }, cookie: agent4Cookie });
  check("second agent is told who has it", steal.status === 409 && steal.json.holderName === "Agent Three");
  const badOutcome = await call(LA, { method: "POST", query: { id: first.id, action: "disposition" }, body: { l1: "connected", l2: null }, cookie: agentCookie });
  check("connected without what they said → 400", badOutcome.status === 400);
  const [d1, d2] = await Promise.all([
    call(LA, { method: "POST", query: { id: first.id, action: "disposition" }, body: { l1: "busy", l2: null, note: "", agentId: "SUPER_001" }, cookie: agentCookie }),
    call(LA, { method: "POST", query: { id: first.id, action: "disposition" }, body: { l1: "busy", l2: null, note: "" }, cookie: agentCookie }),
  ]);
  check("double-click saves exactly once", [d1.status, d2.status].sort().join(",") === "200,409", `${d1.status},${d2.status}`);
  const { rows: disp } = await query<{ agent_id: string; count: string }>("select agent_id, count(*)::text from dispositions where lead_id = $1 group by agent_id", [first.id]);
  check("disposition recorded once, under the session's agent", disp.length === 1 && disp[0].agent_id === "AGENT_003" && disp[0].count === "1");
  const saved = d1.status === 200 ? d1.json : d2.json;
  check("failed call is held back for the retry gap", !!saved.retryAfter && Date.parse(saved.retryAfter) > Date.now() + 10 * 60000);
  check("detail shows Dhaka time", /back around \d{2}:\d{2}/.test(saved.detail), saved.detail);
  const q2 = await call(L, { query: { queue: "1", agentId: "AGENT_003" }, cookie: agentCookie });
  check("the held lead is not back at the top of the queue", !q2.json.some((l: any) => l.id === first.id));

  console.log("\nEscalation needs a reason");
  const second = q2.json[0];
  await call(LA, { method: "POST", query: { id: second.id, action: "claim" }, cookie: agentCookie });
  const noReason = await call(LA, { method: "POST", query: { id: second.id, action: "escalate" }, body: {}, cookie: agentCookie });
  check("escalate without a reason → 400", noReason.status === 400);
  const esc = await call(LA, { method: "POST", query: { id: second.id, action: "escalate" }, body: { reason: "Wants a discount" }, cookie: agentCookie });
  check("escalate with a reason works", esc.status === 200 && esc.json.escalatedReason === "Wants a discount");
  const st = await call(stats as Handler, { cookie: leadCookie });
  check("team lead sees the reason", st.json.escalated?.[0]?.escalated_reason === "Wants a discount");
  check("roster lists each agent once", st.json.roster.filter((r: any) => r.agentId === "AGENT_003").length === 1);
  const agentUnesc = await call(LA, { method: "POST", query: { id: second.id, action: "unescalate" }, cookie: agentCookie });
  check("agent cannot un-escalate → 403", agentUnesc.status === 403);

  console.log("\nInternational number auto-escalates, and can be closed instead of reopened");
  const intlLead = await call(L, { method: "POST", body: { name: "Overseas Caller", phone: "+447000000099" }, cookie: reqCookie });
  await call(LA, { method: "POST", query: { id: intlLead.json.id, action: "claim" }, cookie: agentCookie });
  const intlDisp = await call(LA, { method: "POST", query: { id: intlLead.json.id, action: "disposition" }, body: { l1: "international", l2: null, note: "" }, cookie: agentCookie });
  check("international disposition saves without needing an l2", intlDisp.status === 200, String(intlDisp.status));
  check("it auto-escalates with a fixed reason", intlDisp.json.escalated === true && intlDisp.json.escalatedReason.includes("International"));
  check("status is left alone, not force-closed", intlDisp.json.status === "waiting");
  const intlQueueCheck = await call(L, { query: { queue: "1", agentId: "AGENT_003" }, cookie: agentCookie });
  check("it disappears from the agent queue like any escalation", !intlQueueCheck.json.some((l: any) => l.id === intlLead.json.id));
  const closeIt = await call(LA, { method: "POST", query: { id: intlLead.json.id, action: "unescalate" }, body: { resolution: "closed" }, cookie: leadCookie });
  check("team lead can close it instead of reopening it", closeIt.status === 200 && closeIt.json.status === "closed" && closeIt.json.escalated === false);

  console.log("\n'Already has an appointment' outcome");
  const dupPatient = await call(L, { method: "POST", body: { name: "Existing Patient", phone: "01799900001" }, cookie: reqCookie });
  await call(LA, { method: "POST", query: { id: dupPatient.json.id, action: "claim" }, cookie: agentCookie });
  const alreadyDisp = await call(LA, { method: "POST", query: { id: dupPatient.json.id, action: "disposition" }, body: { l1: "connected", l2: "already_handled", note: "" }, cookie: agentCookie });
  check("saves as a terminal, non-booked outcome", alreadyDisp.status === 200 && alreadyDisp.json.status === "closed");
  check("detail names the outcome", alreadyDisp.json.detail.includes("Already has an appointment"));

  console.log("\nRequester default channel");
  const invWithChannel = await call(invites as Handler, {
    method: "POST",
    body: { role: "requester", facility: "", callingNumber: "", defaultChannel: "Door2Door Campaign" },
    cookie: superCookie,
  });
  check("invite carries the default channel", invWithChannel.json.defaultChannel === "Door2Door Campaign");
  const invAgentIgnoresChannel = await call(invites as Handler, {
    method: "POST",
    body: { role: "agent", facility: "", callingNumber: "", defaultChannel: "Door2Door Campaign" },
    cookie: superCookie,
  });
  check("a non-requester invite ignores the field", invAgentIgnoresChannel.json.defaultChannel === "");
  const claimed = await call(claimInvite as Handler, {
    method: "POST",
    query: { token: invWithChannel.json.token },
    body: { firstName: "Chan", lastName: "Nel", eid: "8001", email: "", password: "correct-horse" },
  });
  check("claiming the invite carries the default channel onto the new account", claimed.json.account?.defaultChannel === "Door2Door Campaign");
  const wrongEdit = await call(accountAction as Handler, {
    method: "POST",
    query: { id: "REQ_005", action: "set-default-channel" },
    body: { defaultChannel: "Website LP" },
    cookie: leadCookie,
  });
  check("team lead cannot set a requester's default channel → 403", wrongEdit.status === 403);
  const editChannel = await call(accountAction as Handler, {
    method: "POST",
    query: { id: "REQ_005", action: "set-default-channel" },
    body: { defaultChannel: "Website LP" },
    cookie: superCookie,
  });
  check("superadmin sets a requester's default channel", editChannel.status === 200);
  const acctsAfter = await call(accounts as Handler, { cookie: superCookie });
  check("it shows up on the roster", acctsAfter.json.find((a: any) => a.employeeId === "REQ_005")?.defaultChannel === "Website LP");
  const clearChannel = await call(accountAction as Handler, {
    method: "POST",
    query: { id: "REQ_005", action: "set-default-channel" },
    body: { defaultChannel: "" },
    cookie: superCookie,
  });
  const acctsCleared = await call(accounts as Handler, { cookie: superCookie });
  check(
    "clearing it goes back to no default",
    clearChannel.status === 200 && acctsCleared.json.find((a: any) => a.employeeId === "REQ_005")?.defaultChannel === "",
  );

  console.log("\nRevocation: reset and deactivation end sessions immediately");
  const reset = await call(accountAction as Handler, { method: "POST", query: { id: "AGENT_004", action: "reset-password" }, cookie: superCookie });
  check("superadmin resets a password", reset.status === 200 && typeof reset.json.password === "string");
  const afterReset = await call(accounts as Handler, { cookie: agent4Cookie });
  check("the reset account's live session is dead", afterReset.status === 401);
  await call(LA, { method: "POST", query: { id: q2.json[1].id, action: "claim" }, cookie: agentCookie });
  const deact = await call(accountAction as Handler, { method: "POST", query: { id: "AGENT_003", action: "toggle-active" }, body: { active: false }, cookie: superCookie });
  check("superadmin deactivates an agent", deact.status === 200);
  const afterDeact = await call(accounts as Handler, { cookie: agentCookie });
  check("the deactivated agent's session is dead", afterDeact.status === 401);
  const { rows: held } = await query<{ count: string }>("select count(*)::text from leads where (claimed_by = 'AGENT_003' or assigned_to = 'AGENT_003') and status in ('waiting','trying') and not escalated and id <> $1", [first.id]);
  check("their open leads went back to the pool", held[0].count === "0", held[0].count);
  const signBackIn = await signIn("AGENT_003", "correct-horse");
  check("and they can't sign back in", signBackIn.json.error === "unknown_id");

  console.log("\nCDR upload: 40,000 rows in one request");
  const n = 40000;
  const cdrBody = {
    fileName: "sept.csv",
    extension: Array.from({ length: n }, (_, i) => (i % 2 ? "301" : "302")),
    numberDialled: Array.from({ length: n }, (_, i) => `01712${String(i).padStart(6, "0")}`),
    startTime: Array.from({ length: n }, () => "2026-09-10 11:00:00"),
    durationSec: Array.from({ length: n }, (_, i) => i % 90),
    connected: Array.from({ length: n }, (_, i) => i % 3 === 0),
  };
  const bytes = Buffer.byteLength(JSON.stringify(cdrBody));
  check("payload fits under Vercel's 4.5 MB body limit", bytes < 4.5 * 1024 * 1024, `${(bytes / 1024 / 1024).toFixed(2)} MB`);
  const t1 = Date.now();
  const up = await call(cdr as Handler, { method: "POST", query: { monthKey: "2026-09" }, body: cdrBody, cookie: leadCookie });
  check("upload succeeds", up.status === 200 && up.json.count === n, `${Date.now() - t1} ms`);
  const reup = await call(cdr as Handler, { method: "POST", query: { monthKey: "2026-09" }, body: cdrBody, cookie: leadCookie });
  const { rows: cnt } = await query<{ count: string }>("select count(*)::text from cdr_rows where month_key = '2026-09'");
  check("re-uploading replaces the month instead of doubling it", reup.status === 200 && cnt[0].count === String(n), cnt[0].count);
  const ragged = await call(cdr as Handler, { method: "POST", query: { monthKey: "2026-09" }, body: { ...cdrBody, connected: [true] }, cookie: leadCookie });
  check("mismatched columns refused", ragged.status === 400);
  const { rows: cnt2 } = await query<{ count: string }>("select count(*)::text from cdr_rows where month_key = '2026-09'");
  check("…and the stored month is untouched", cnt2[0].count === String(n));
  const badMonth = await call(cdr as Handler, { query: { monthKey: "2026-13" }, cookie: leadCookie });
  check("invalid month key refused", badMonth.status === 400);
  const report = await call(cdr as Handler, { query: { monthKey: "2026-09" }, cookie: leadCookie });
  const a4 = report.json.perAgent.find((r: any) => r.id === "AGENT_004");
  check("per-agent report counts only that agent's extension", a4?.dials === n / 2, String(a4?.dials));

  console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) FAILED.`}`);
  await pool.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
