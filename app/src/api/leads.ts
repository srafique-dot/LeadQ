import type { Lead, LeadStatus, LeadType, NewLeadInput, Level1Code, Level2Code } from "./types";

/**
 * Real backend calls. Every function here mirrors the mock's shape from
 * phase 1 — this file is the only thing that changed to go from
 * localStorage to the live API. A few functions consolidate into a single
 * endpoint where the real backend does that more efficiently than the mock
 * ever could (see getSupervisorStats, getCdrMonth).
 */

export const LEAD_TYPES: { code: LeadType; label: string }[] = [
  { code: "appointment", label: "Doctor appointment" },
  { code: "vaccine_query", label: "Vaccine query" },
  { code: "lab_test", label: "Lab tests" },
  { code: "radiology", label: "Radiology" },
  { code: "investigative_procedure", label: "Investigative procedure" },
  { code: "surgery_package", label: "Surgery package" },
  { code: "health_package", label: "Health package" },
  { code: "corporate_health", label: "Corporate health" },
  { code: "therapy", label: "Therapies" },
  { code: "dialysis", label: "Dialysis" },
  { code: "ipd", label: "IPD admission" },
  { code: "day_care", label: "Day care" },
  { code: "international_patient", label: "International patient" },
  { code: "general_inquiry", label: "General inquiry" },
];

export function leadTypeLabel(t: LeadType): string {
  return LEAD_TYPES.find((o) => o.code === t)?.label ?? t;
}

export function digitsOf(phone: string): string {
  return String(phone || "").replace(/\D/g, "").slice(-10);
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Request failed: ${url}`);
  return res.json();
}

async function postJson<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? `Request failed: ${url}`);
  return json;
}

export function listLeadsForOwner(ownerId: string): Promise<Lead[]> {
  return getJson(`/api/leads?ownerId=${encodeURIComponent(ownerId)}`);
}

export async function findLeadByPhone(phone: string): Promise<Lead | undefined> {
  if (digitsOf(phone).length < 7) return undefined;
  const lead = await getJson<Lead | null>(`/api/leads?phone=${encodeURIComponent(phone)}`);
  return lead ?? undefined;
}

export async function getLead(id: string): Promise<Lead | undefined> {
  const all = await getAllLeads();
  return all.find((l) => l.id === id);
}

export function serviceLine(input: { doctor: string; department: string; patientName: string }): string {
  const who = input.doctor.trim() || input.department.trim();
  return input.patientName.trim() ? `${who} · for ${input.patientName.trim()}` : who;
}

export function createLead(input: NewLeadInput, ownerId: string, ownerName: string, channel = "Manual entry"): Promise<Lead> {
  return postJson("/api/leads", { ...input, ownerId, ownerName, channel });
}

/** Attaches a new enquiry to an existing lead on the same phone number
 * instead of creating a second card — the agent still sees one lead. */
export function mergeIntoLead(existingId: string, entry?: { channel: string; service: string; note: string }): Promise<Lead> {
  return postJson(`/api/leads/${existingId}/merge`, { entry });
}

export interface ImportRow {
  name: string;
  phone: string;
  facility: string;
  doctor: string;
  department: string;
  email: string;
  note: string;
  leadType: LeadType;
  wantDate: string;
  preferredTime: string;
  urgent: boolean;
  urgentReason: string;
}

export interface ImportResult {
  created: Lead[];
  duplicates: { row: ImportRow; existing: Lead }[];
}

export function importLeads(
  rows: ImportRow[],
  cohort: string,
  ownerId: string,
  ownerName: string,
  cohortInstructions = "",
): Promise<ImportResult> {
  return postJson("/api/leads?action=import", { rows, cohort, cohortInstructions, ownerId, ownerName });
}

/** Fetched on demand (not preloaded) — an agent taps the cohort chip when
 * they want to refresh their memory on the campaign brief. Empty string if
 * this cohort has no instructions on file. */
export async function getCohortInstructions(cohort: string): Promise<string> {
  const json = await getJson<{ instructions: string }>(`/api/cohorts/${encodeURIComponent(cohort)}`);
  return json.instructions;
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

/** This agent's own queue: the working set routed to them, topped up from
 * the unassigned pool on each call, plus anything overdue they're allowed to
 * cover while its owner is away. Urgent first, then oldest first. */
export function getAgentQueue(agentId: string): Promise<Lead[]> {
  return getJson(`/api/leads?queue=1&agentId=${encodeURIComponent(agentId)}`);
}

export class LeadClaimedError extends Error {
  constructor(public holderName: string) {
    super(`${holderName} is on this lead`);
    this.name = "LeadClaimedError";
  }
}

/** Takes the "I'm on this call" lock. Throws LeadClaimedError if another
 * agent got there first — the check is atomic server-side, so this is the
 * only thing standing between two agents and the same phone number. */
export async function claimLead(leadId: string, agentId: string): Promise<Lead> {
  const res = await fetch(`/api/leads/${leadId}/claim`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agentId }),
  });
  const json = await res.json();
  if (res.status === 409) throw new LeadClaimedError(json.holderName ?? "Another agent");
  if (!res.ok) throw new Error(json.error ?? "Could not open that lead.");
  return json;
}

export function releaseLead(leadId: string, agentId: string): Promise<Lead> {
  return postJson(`/api/leads/${leadId}/release`, { agentId });
}

/** Supervisor override — hand a lead to a specific agent, or pass null to
 * drop it back into the pool. Clears any stuck claim on the way. */
export function reassignLead(leadId: string, agentId: string | null): Promise<Lead> {
  return postJson(`/api/leads/${leadId}/reassign`, { agentId });
}

export async function searchLeads(term: string): Promise<Lead[]> {
  const t = term.trim().toLowerCase();
  const all = await getAllLeads();
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

/** Applies a two-level call disposition to a lead. The status-transition
 * rules (terminal/failed/callback ladder) live server-side now, ported
 * 1:1 from this file's original mock logic — see api/leads/[id]/[action].ts. */
export function saveDisposition(leadId: string, input: DispositionInput): Promise<Lead> {
  return postJson(`/api/leads/${leadId}/disposition`, input);
}

export function escalateLead(leadId: string, agentId: string, agentName: string): Promise<Lead> {
  return postJson(`/api/leads/${leadId}/escalate`, { agentId, agentName });
}

export function splitMergedLead(leadId: string): Promise<Lead> {
  return postJson(`/api/leads/${leadId}/split`);
}

export function unescalateLead(leadId: string): Promise<Lead> {
  return postJson(`/api/leads/${leadId}/unescalate`);
}

// ---- Supervisor: live floor (app data only — no call durations, no dial counts) ----

export function getAllLeads(): Promise<Lead[]> {
  return getJson("/api/leads");
}

export interface AgentDayStats {
  agentId: string;
  agentName: string;
  worked: number;
  outcomes: number;
  booked: number;
  noAnswer: number;
}

export interface QueueStats {
  waiting: number;
  oldestWaitMin: number;
  workedToday: number;
  outcomesToday: number;
  bookedToday: number;
}

export interface LeadSummary {
  id: string;
  name: string;
  facility: string;
  urgent?: boolean;
  createdAt?: string;
  nextActionDate?: string;
  escalatedBy?: string;
  escalatedAt?: string;
}

/** A lead someone claimed and then stopped working — opened, never
 * dispositioned. The claim expires on its own; this surfaces it first. */
export interface AbandonedClaim {
  id: string;
  name: string;
  claimedBy: string;
  claimedByName: string;
  heldMin: number;
}

export interface RosterEntry {
  agentId: string;
  agentName: string;
  presence: "available" | "break" | "off";
  assigned: number;
  onCall: string;
}

export interface SupervisorStats {
  queue: QueueStats;
  dayStatsByAgent: AgentDayStats[];
  pastTarget: LeadSummary[];
  overdueCallbacks: LeadSummary[];
  escalated: LeadSummary[];
  abandoned: AbandonedClaim[];
  roster: RosterEntry[];
}

/** One combined call — the server aggregates today's queue/agent stats plus
 * the three "needs attention" lists (past target, overdue callback,
 * escalated) in a single query round trip. */
export async function getSupervisorStats(): Promise<SupervisorStats> {
  const json = await getJson<{
    queue: QueueStats;
    dayStatsByAgent: AgentDayStats[];
    pastTarget: { id: string; name: string; facility: string; urgent: boolean; created_at: string }[];
    overdueCallbacks: { id: string; name: string; facility: string; next_action_date: string }[];
    escalated: { id: string; name: string; escalated_by: string; escalated_at: string }[];
    abandoned: AbandonedClaim[];
    roster: RosterEntry[];
  }>("/api/supervisor/stats");

  return {
    queue: json.queue,
    dayStatsByAgent: json.dayStatsByAgent,
    pastTarget: json.pastTarget.map((r) => ({ id: r.id, name: r.name, facility: r.facility, urgent: r.urgent, createdAt: r.created_at })),
    overdueCallbacks: json.overdueCallbacks.map((r) => ({ id: r.id, name: r.name, facility: r.facility, nextActionDate: r.next_action_date })),
    escalated: json.escalated.map((r) => ({ id: r.id, name: r.name, facility: "", escalatedBy: r.escalated_by, escalatedAt: r.escalated_at })),
    abandoned: json.abandoned ?? [],
    roster: json.roster ?? [],
  };
}

// ---- Supervisor: monthly CDR report ----

export interface CdrRow {
  extension: string;
  numberDialled: string;
  startTime: string;
  durationSec: number;
  connected: boolean;
}

export interface CdrAgentStat {
  id: string;
  name: string;
  dials: number;
  connected: number;
  talkSec: number;
  booked: number;
  missing: number;
}

export interface CdrMonth {
  fileName: string;
  uploadedBy: string;
  uploadedAt: string;
  perAgent: CdrAgentStat[];
}

export function getCdrMonth(monthKey: string): Promise<CdrMonth | null> {
  return getJson(`/api/cdr/${monthKey}`);
}

export function saveCdrMonth(monthKey: string, fileName: string, uploadedBy: string, rows: CdrRow[]): Promise<{ ok: true; count: number }> {
  return postJson(`/api/cdr/${monthKey}`, { fileName, uploadedBy, rows });
}
