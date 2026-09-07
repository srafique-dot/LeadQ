import type { Lead, LeadStatus, NewLeadInput } from "./types";

/**
 * Mock leads store for phase 1. Same contract-first shape as auth.ts: every
 * export here is what a real `/leads` API would expose, backed for now by
 * localStorage instead of Postgres.
 */

const LEADS_KEY = "umch.mock.leads";

const SEED_LEADS: Lead[] = [
  { id: "L-24612", name: "Ummey Habiba Nahar", phone: "+880 1741 556 022", facility: "UMCH Main", area: "", doctor: "Prof. A.Q.M. Mohsen", department: "", patientName: "her son", wantDate: "", note: "", status: "waiting", detail: "Urgent · first in the queue · 1m", urgent: true, urgentReason: "Referred by Prof. Mohsen himself", merged: false, cohort: "", ownerId: "BD-007", ownerName: "Ishrat Sultana", createdAt: "2026-09-07T08:00:00.000Z" },
  { id: "L-24559", name: "Shamsun Nahar", phone: "+880 1521 330 774", facility: "Medix Uttara", area: "", doctor: "Dr. Syeda Nure Jannat", department: "", patientName: "", wantDate: "", note: "", status: "booked", detail: "Booked + paid · 06 Sep", urgent: false, urgentReason: "", merged: false, cohort: "Sep health camp — Uttara", ownerId: "BD-007", ownerName: "Ishrat Sultana", createdAt: "2026-09-06T08:00:00.000Z" },
  { id: "L-24601", name: "Kamrul Hasan", phone: "+880 1713 908 221", facility: "UMCH Main", area: "", doctor: "Prof. A.Q.M. Mohsen", department: "", patientName: "", wantDate: "", note: "", status: "waiting", detail: "In the queue · 4m", urgent: false, urgentReason: "", merged: false, cohort: "", ownerId: "BD-007", ownerName: "Ishrat Sultana", createdAt: "2026-09-07T07:56:00.000Z" },
  { id: "L-24588", name: "Sultana Razia", phone: "+880 1911 776 540", facility: "Medix Uttara", area: "", doctor: "Dr. Sumia Bari", department: "", patientName: "", wantDate: "", note: "", status: "trying", detail: "Call 2 of 4 · no answer", urgent: false, urgentReason: "", merged: false, cohort: "Sep health camp — Uttara", ownerId: "BD-007", ownerName: "Ishrat Sultana", createdAt: "2026-09-06T09:00:00.000Z" },
  { id: "L-24572", name: "Rahima Khatun", phone: "+880 1711 204 556", facility: "Medix Uttara", area: "", doctor: "", department: "Cardiology", patientName: "", wantDate: "", note: "", status: "trying", detail: "Merged with a Meta lead · call 1 of 4", urgent: false, urgentReason: "", merged: true, cohort: "Meta ads — Sep", ownerId: "BD-007", ownerName: "Ishrat Sultana", createdAt: "2026-09-05T09:00:00.000Z" },
  { id: "L-24540", name: "Jamil Uddin", phone: "+880 1611 200 913", facility: "UMCH Main", area: "", doctor: "", department: "General Medicine", patientName: "", wantDate: "", note: "", status: "closed", detail: "Not interested — price · 05 Sep", urgent: false, urgentReason: "", merged: false, cohort: "Meta ads — Sep", ownerId: "BD-007", ownerName: "Ishrat Sultana", createdAt: "2026-09-05T08:00:00.000Z" },
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

function serviceLine(input: { doctor: string; department: string; patientName: string }): string {
  const who = input.doctor.trim() || input.department.trim();
  return input.patientName.trim() ? `${who} · for ${input.patientName.trim()}` : who;
}

export function createLead(input: NewLeadInput, ownerId: string, ownerName: string): Lead {
  const leads = load();
  const lead: Lead = {
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
    merged: false,
    cohort: input.cohort,
    ownerId,
    ownerName,
    createdAt: new Date().toISOString(),
  };
  save([lead, ...leads]);
  return lead;
}

/** Attaches a new enquiry to an existing lead on the same phone number
 * instead of creating a second card — the agent still sees one lead. */
export function mergeIntoLead(existingId: string): Lead {
  const leads = load();
  const next = leads.map((l) => (l.id === existingId ? { ...l, merged: true } : l));
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

export { serviceLine };
