import type { Lead, LeadStatus, NewLeadInput, Level1Code, Level2Code, DispositionRecord } from "./types";

/**
 * Mock leads store for phase 1. Same contract-first shape as auth.ts: every
 * export here is what a real `/leads` API would expose, backed for now by
 * localStorage instead of Postgres.
 */

const LEADS_KEY = "umch.mock.leads";

function base(over: Partial<Lead> & Pick<Lead, "id" | "name" | "phone" | "facility" | "status" | "detail" | "createdAt">): Lead {
  return {
    area: "",
    doctor: "",
    department: "",
    patientName: "",
    wantDate: "",
    note: "",
    urgent: false,
    urgentReason: "",
    merged: false,
    cohort: "",
    ownerId: "BD-007",
    ownerName: "Ishrat Sultana",
    channel: "Manual entry",
    existing: false,
    attempt: 1,
    history: [],
    entries: [],
    nextActionDate: "",
    erpRefType: "",
    erpRefValue: "",
    escalated: false,
    escalatedBy: "",
    escalatedAt: "",
    ...over,
  };
}

const SEED_LEADS: Lead[] = [
  base({ id: "L-24612", name: "Ummey Habiba Nahar", phone: "+880 1741 556 022", facility: "UMCH Main", doctor: "Prof. A.Q.M. Mohsen", patientName: "her son", status: "waiting", detail: "Urgent · first in the queue · 1m", urgent: true, urgentReason: "Referred by Prof. Mohsen himself", channel: "Website LP", createdAt: "2026-09-08T08:00:00.000Z" }),
  base({ id: "L-24559", name: "Shamsun Nahar", phone: "+880 1521 330 774", facility: "Medix Uttara", doctor: "Dr. Syeda Nure Jannat", status: "booked", detail: "Booked + paid · 06 Sep", cohort: "Sep health camp — Uttara", channel: "Meta Lead Ads", createdAt: "2026-09-06T08:00:00.000Z" }),
  base({ id: "L-24601", name: "Kamrul Hasan", phone: "+880 1713 908 221", facility: "UMCH Main", doctor: "Prof. A.Q.M. Mohsen", status: "waiting", detail: "In the queue · 4m", channel: "Google Lead Form", createdAt: "2026-09-08T07:56:00.000Z" }),
  base({ id: "L-24588", name: "Sultana Razia", phone: "+880 1911 776 540", facility: "Medix Uttara", doctor: "Dr. Sumia Bari", status: "trying", detail: "Call 2 of 4 · no answer", attempt: 2, cohort: "Sep health camp — Uttara", channel: "Website LP",
    history: [{ attempt: 1, when: "07 Sep, 10:12 AM", whenISO: "2026-09-07T10:12:00.000Z", agentId: "CC-002", agentName: "Nusrat Jahan", l1: "not_responding", l2: null, note: "Rang out, no answer." }],
    createdAt: "2026-09-06T09:00:00.000Z" }),
  base({ id: "L-24572", name: "Rahima Khatun", phone: "+880 1711 204 556", facility: "Medix Uttara", department: "Cardiology", status: "trying", detail: "Merged with a Meta lead · call 1 of 4", merged: true, cohort: "Meta ads — Sep", channel: "Meta Lead Ads",
    entries: [
      { channel: "Meta Lead Ads", when: "05 Sep, 11:42 AM", service: "Cardiology", note: "My father has chest pain since 2 weeks. Please advise cost of a full cardiac check up." },
      { channel: "Website LP", when: "04 Sep, 09:15 PM", service: "Cardiology", note: "Chest pain, need to see a heart doctor. Please call." },
    ],
    createdAt: "2026-09-05T09:00:00.000Z" }),
  base({ id: "L-24540", name: "Jamil Uddin", phone: "+880 1611 200 913", facility: "UMCH Main", department: "General Medicine", status: "closed", detail: "Not interested — price · 05 Sep", cohort: "Meta ads — Sep", channel: "Meta Lead Ads",
    history: [{ attempt: 1, when: "05 Sep, 03:20 PM", whenISO: "2026-09-05T15:20:00.000Z", agentId: "CC-002", agentName: "Nusrat Jahan", l1: "connected", l2: "ni_price", note: "Package above budget." }],
    createdAt: "2026-09-05T08:00:00.000Z" }),
];

function load(): Lead[] {
  try {
    const raw = localStorage.getItem(LEADS_KEY);
    if (raw) return JSON.parse(raw) as Lead[];
  } catch {
    /* fall through to reseed */
  }
  localStorage.setItem(LEADS_KEY, JSON.stringify(SEED_LEADS));
  return SEED_LEADS.slice();
}

function save(leads: Lead[]) {
  localStorage.setItem(LEADS_KEY, JSON.stringify(leads));
}

export function digitsOf(phone: string): string {
  return String(phone || "").replace(/\D/g, "").slice(-10);
}

export function listLeadsForOwner(ownerId: string): Lead[] {
  return load()
    .filter((l) => l.ownerId === ownerId)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export function findLeadByPhone(phone: string): Lead | undefined {
  const digits = digitsOf(phone);
  if (digits.length < 7) return undefined;
  return load().find((l) => digitsOf(l.phone) === digits);
}

export function getLead(id: string): Lead | undefined {
  return load().find((l) => l.id === id);
}

function serviceLine(input: { doctor: string; department: string; patientName: string }): string {
  const who = input.doctor.trim() || input.department.trim();
  return input.patientName.trim() ? `${who} · for ${input.patientName.trim()}` : who;
}

export function createLead(input: NewLeadInput, ownerId: string, ownerName: string, channel = "Manual entry"): Lead {
  const leads = load();
  const lead = base({
    id: "L-" + Math.random().toString(36).slice(2, 8).toUpperCase(),
    name: input.name.trim(),
    phone: input.phone.trim(),
    facility: input.facility,
    area: input.area.trim(),
    doctor: input.doctor.trim(),
    department: input.department.trim(),
    patientName: input.patientName.trim(),
    wantDate: input.wantDate,
    note: input.note.trim(),
    status: "waiting",
    detail: input.urgent ? "Urgent · first in the queue · just now" : "In the queue · just now",
    urgent: input.urgent,
    urgentReason: input.urgentReason.trim(),
    cohort: input.cohort,
    ownerId,
    ownerName,
    channel,
    createdAt: new Date().toISOString(),
  });
  save([lead, ...leads]);
  return lead;
}

/** Attaches a new enquiry to an existing lead on the same phone number
 * instead of creating a second card — the agent still sees one lead. */
export function mergeIntoLead(existingId: string, entry?: { channel: string; service: string; note: string }): Lead {
  const leads = load();
  const next = leads.map((l) => {
    if (l.id !== existingId) return l;
    const firstEntry = l.entries.length ? l.entries : [{ channel: l.channel, when: l.createdAt, service: serviceLine(l), note: l.note }];
    return {
      ...l,
      merged: true,
      entries: entry ? [{ channel: entry.channel, when: "just now", service: entry.service, note: entry.note }, ...firstEntry] : firstEntry,
    };
  });
  save(next);
  return next.find((l) => l.id === existingId)!;
}

export interface ImportRow {
  name: string;
  phone: string;
  facility: string;
  doctorOrDept: string;
}

export interface ImportResult {
  created: Lead[];
  duplicates: { row: ImportRow; existing: Lead }[];
}

export function importLeads(rows: ImportRow[], cohort: string, ownerId: string, ownerName: string): ImportResult {
  const created: Lead[] = [];
  const duplicates: ImportResult["duplicates"] = [];
  for (const row of rows) {
    const existing = findLeadByPhone(row.phone);
    if (existing) {
      duplicates.push({ row, existing });
      continue;
    }
    created.push(
      createLead(
        {
          name: row.name,
          phone: row.phone,
          facility: row.facility,
          area: "",
          doctor: row.doctorOrDept,
          department: "",
          patientName: "",
          wantDate: "",
          note: "",
          urgent: false,
          urgentReason: "",
          cohort,
        },
        ownerId,
        ownerName,
      ),
    );
  }
  return { created, duplicates };
}

export function statusLabel(status: LeadStatus): string {
  return { waiting: "Waiting for a call", trying: "Being called", booked: "Booked", closed: "Closed" }[status];
}

// ---- Agent queue + disposition ----

export const LEVEL1: { code: Level1Code; label: string }[] = [
  { code: "connected", label: "They answered" },
  { code: "not_responding", label: "No answer" },
  { code: "busy", label: "Line was busy" },
  { code: "number_off", label: "Phone switched off" },
  { code: "invalid_number", label: "Wrong number" },
  { code: "call_rejected", label: "They cut the call" },
];

export const LEVEL2: { code: Level2Code; label: string; kind: "win" | "open" | "lost" }[] = [
  { code: "appointment_purchased", label: "Appointment booked + paid", kind: "win" },
  { code: "appointment_booked", label: "Appointment booked, not paid", kind: "win" },
  { code: "info_given", label: "Will decide later", kind: "open" },
  { code: "callback_later", label: "Call them back later", kind: "open" },
  { code: "ni_price", label: "Not interested — price", kind: "lost" },
  { code: "ni_distance", label: "Not interested — too far", kind: "lost" },
  { code: "ni_elsewhere", label: "Not interested — went elsewhere", kind: "lost" },
  { code: "wrong_person", label: "Wrong person", kind: "lost" },
  { code: "duplicate", label: "Same lead twice", kind: "lost" },
];

export const QUICK_NOTES: Record<string, string[]> = {
  appointment_purchased: ["Paid in full on call", "Paid the advance", "Asked for directions"],
  appointment_booked: ["Will pay at the counter", "Bringing previous reports", "Asked for directions"],
  info_given: ["Will discuss with family", "Wants price sheet", "Comparing hospitals"],
  callback_later: ["At work — call after 7 PM", "Travelling this week", "Call tomorrow morning"],
  ni_price: ["Package above budget", "Expected insurance cover"],
  ni_distance: ["Lives outside Dhaka", "Wants a nearer facility"],
  ni_elsewhere: ["Admitted elsewhere", "Consulted own doctor"],
  wrong_person: ["Number belongs to someone else", "Relative filled the form"],
  duplicate: ["Booked under another enquiry", "Called twice today"],
  not_responding: ["Rang out, no answer", "Tried a different hour"],
  busy: ["Engaged tone both tries"],
  number_off: ["Switched off all day"],
  invalid_number: ["Digit count wrong"],
  call_rejected: ["Cut immediately"],
};

export const TERMINAL: Level2Code[] = ["appointment_purchased", "appointment_booked", "ni_price", "ni_distance", "ni_elsewhere", "wrong_person", "duplicate"];
export const FAILED: Level1Code[] = ["not_responding", "busy", "number_off", "call_rejected"];
export const MAX_ATTEMPTS = 4;

/** Leads eligible for an agent to work: open, not sent to a supervisor,
 * urgent first, then oldest first (arrival order). System decides — the
 * agent doesn't choose. */
export function getAgentQueue(): Lead[] {
  const today = new Date().toISOString().slice(0, 10);
  return load()
    .filter((l) => (l.status === "waiting" || l.status === "trying") && !l.escalated)
    .filter((l) => !l.nextActionDate || l.nextActionDate <= today)
    .sort((a, b) => {
      if (a.urgent !== b.urgent) return a.urgent ? -1 : 1;
      return a.createdAt < b.createdAt ? -1 : 1;
    });
}

export function searchLeads(term: string): Lead[] {
  const t = term.trim().toLowerCase();
  const all = load();
  if (!t) return all.slice(0, 20);
  return all.filter((l) => (l.name + l.phone).toLowerCase().includes(t)).slice(0, 20);
}

export interface DispositionInput {
  l1: Level1Code;
  l2: Level2Code | null;
  note: string;
  nextActionDate: string;
  erpRefType: "booking" | "invoice" | "";
  erpRefValue: string;
  agentId: string;
  agentName: string;
}

function formatNow(): string {
  const d = new Date();
  const pad = (n: number) => (n < 10 ? "0" + n : String(n));
  const hours = d.getHours();
  const h12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${pad(d.getDate())} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getMonth()]}, ${pad(h12)}:${pad(d.getMinutes())} ${hours >= 12 ? "PM" : "AM"}`;
}

/** Applies a two-level call disposition to a lead: logs history, and moves
 * the lead to its next state per the attempt ladder (README "Agent call
 * flow" save blockers + terminal/failed code lists). */
export function saveDisposition(leadId: string, input: DispositionInput): Lead {
  const leads = load();
  const lead = leads.find((l) => l.id === leadId);
  if (!lead) throw new Error("Lead not found: " + leadId);

  const record: DispositionRecord = {
    attempt: lead.attempt,
    when: formatNow(),
    whenISO: new Date().toISOString(),
    agentId: input.agentId,
    agentName: input.agentName,
    l1: input.l1,
    l2: input.l2,
    note: input.note.trim(),
  };

  const isTerminal = input.l2 && TERMINAL.includes(input.l2);
  const isFailed = FAILED.includes(input.l1);
  const isCallback = input.l2 === "callback_later";
  const l2Meta = LEVEL2.find((o) => o.code === input.l2);

  let status: LeadStatus = lead.status;
  let attempt = lead.attempt;
  let detail = lead.detail;
  let nextActionDate = "";

  if (isTerminal) {
    status = l2Meta?.kind === "win" ? "booked" : "closed";
    detail = (l2Meta?.label ?? "Closed") + " · " + formatNow();
  } else if (isFailed) {
    if (lead.attempt >= MAX_ATTEMPTS) {
      status = "closed";
      detail = "Exhausted after 4 attempts · " + formatNow();
    } else {
      attempt = lead.attempt + 1;
      status = "trying";
      const back = new Date(Date.now() + 12 * 60000);
      const pad = (n: number) => (n < 10 ? "0" + n : String(n));
      detail = `Call ${attempt} of 4 · back around ${pad(back.getHours())}:${pad(back.getMinutes())}`;
    }
  } else if (isCallback) {
    status = "trying";
    nextActionDate = input.nextActionDate;
    detail = "Callback scheduled · " + input.nextActionDate;
  } else {
    // info_given or another open, non-scheduled connected outcome
    status = "trying";
    detail = (l2Meta?.label ?? "Open") + " · " + formatNow();
  }

  const next = leads.map((l) =>
    l.id === leadId
      ? {
          ...l,
          status,
          attempt,
          detail,
          nextActionDate,
          history: [...l.history, record],
          erpRefType: input.erpRefType || l.erpRefType,
          erpRefValue: input.erpRefValue || l.erpRefValue,
        }
      : l,
  );
  save(next);
  return next.find((l) => l.id === leadId)!;
}

export function escalateLead(leadId: string, agentId: string, agentName: string): Lead {
  const leads = load();
  const next = leads.map((l) =>
    l.id === leadId ? { ...l, escalated: true, escalatedBy: `${agentId} ${agentName}`, escalatedAt: formatNow() } : l,
  );
  save(next);
  return next.find((l) => l.id === leadId)!;
}

export function splitMergedLead(leadId: string): Lead {
  const leads = load();
  const next = leads.map((l) => (l.id === leadId ? { ...l, merged: false } : l));
  save(next);
  return next.find((l) => l.id === leadId)!;
}

// ---- Supervisor: live floor (app data only — no call durations, no dial counts) ----

export function getAllLeads(): Lead[] {
  return load();
}

function isToday(iso: string): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  const n = new Date();
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
}

export interface AgentDayStats {
  agentId: string;
  agentName: string;
  worked: number;
  outcomes: number;
  booked: number;
  noAnswer: number;
}

/** What the app itself can honestly know about today's work, per agent —
 * derived from disposition history, not from any live presence signal. */
export function getTodayStatsByAgent(): AgentDayStats[] {
  const byAgent = new Map<string, AgentDayStats>();
  for (const lead of load()) {
    for (const h of lead.history) {
      if (!isToday(h.whenISO)) continue;
      const key = h.agentId;
      const cur = byAgent.get(key) ?? { agentId: h.agentId, agentName: h.agentName, worked: 0, outcomes: 0, booked: 0, noAnswer: 0 };
      cur.outcomes += 1;
      if (h.l2 && LEVEL2.find((o) => o.code === h.l2)?.kind === "win") cur.booked += 1;
      if (FAILED.includes(h.l1)) cur.noAnswer += 1;
      byAgent.set(key, cur);
    }
  }
  // "worked" = distinct leads the agent touched today
  const touched = new Map<string, Set<string>>();
  for (const lead of load()) {
    for (const h of lead.history) {
      if (!isToday(h.whenISO)) continue;
      if (!touched.has(h.agentId)) touched.set(h.agentId, new Set());
      touched.get(h.agentId)!.add(lead.id);
    }
  }
  for (const [agentId, stat] of byAgent) stat.worked = touched.get(agentId)?.size ?? 0;
  return Array.from(byAgent.values()).sort((a, b) => b.booked - a.booked);
}

export interface QueueStats {
  waiting: number;
  oldestWaitMin: number;
  workedToday: number;
  outcomesToday: number;
  bookedToday: number;
}

export function getQueueStats(): QueueStats {
  const leads = load();
  const waitingLeads = leads.filter((l) => l.status === "waiting");
  const oldestWaitMin = waitingLeads.reduce((max, l) => {
    const m = Math.floor((Date.now() - Date.parse(l.createdAt)) / 60000);
    return Math.max(max, m);
  }, 0);
  const dayStats = getTodayStatsByAgent();
  return {
    waiting: waitingLeads.length,
    oldestWaitMin,
    workedToday: dayStats.reduce((n, a) => n + a.worked, 0),
    outcomesToday: dayStats.reduce((n, a) => n + a.outcomes, 0),
    bookedToday: dayStats.reduce((n, a) => n + a.booked, 0),
  };
}

/** Leads waiting for a first call longer than the target, with nobody having
 * logged an outcome on them yet. */
export function getLeadsPastTarget(targetMinutes: number): Lead[] {
  return load().filter((l) => l.status === "waiting" && l.history.length === 0 && Date.now() - Date.parse(l.createdAt) > targetMinutes * 60000);
}

/** Callbacks whose promised date has already passed and are still open. */
export function getOverdueCallbacks(): Lead[] {
  const today = new Date().toISOString().slice(0, 10);
  return load().filter((l) => l.nextActionDate && l.nextActionDate < today && (l.status === "waiting" || l.status === "trying"));
}

export function getEscalatedLeads(): Lead[] {
  return load().filter((l) => l.escalated);
}

export function unescalateLead(leadId: string): Lead {
  const leads = load();
  const next = leads.map((l) => (l.id === leadId ? { ...l, escalated: false, escalatedBy: "", escalatedAt: "" } : l));
  save(next);
  return next.find((l) => l.id === leadId)!;
}

// ---- Supervisor: monthly CDR report ----

export interface CdrRow {
  extension: string;
  numberDialled: string;
  startTime: string;
  durationSec: number;
  connected: boolean;
}

export interface CdrMonth {
  fileName: string;
  uploadedAt: string;
  uploadedBy: string;
  monthKey: string;
  rows: CdrRow[];
}

const CDR_KEY = "umch.mock.cdr";

export function listCdrMonths(): Record<string, CdrMonth> {
  try {
    const raw = localStorage.getItem(CDR_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore */
  }
  return {};
}

export function saveCdrMonth(monthKey: string, month: CdrMonth) {
  const all = listCdrMonths();
  all[monthKey] = month;
  localStorage.setItem(CDR_KEY, JSON.stringify(all));
}

export { serviceLine };
