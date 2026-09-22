import { query } from "./_db.js";

export interface LeadRow {
  id: string;
  name: string;
  phone: string;
  lead_type: string;
  facility: string;
  area: string;
  doctor: string;
  department: string;
  patient_name: string;
  want_date: string | null;
  preferred_time: string;
  email: string;
  note: string;
  status: string;
  detail: string;
  urgent: boolean;
  urgent_reason: string;
  merged: boolean;
  cohort: string;
  owner_id: string;
  owner_name: string;
  channel: string;
  existing_patient: boolean;
  attempt: number;
  next_action_date: string | null;
  erp_ref_type: string;
  erp_ref_value: string;
  escalated: boolean;
  escalated_by: string;
  escalated_at: string | null;
  assigned_to: string | null;
  assigned_at: string | null;
  claimed_by: string | null;
  claimed_at: string | null;
  created_at: string;
}

/** Maps a `leads` row plus its entries/history into the shape the frontend's
 * api/leads.ts (Lead type) expects, so swapping the client over to fetch()
 * is a straight drop-in. */
export async function serializeLead(row: LeadRow) {
  const [entries, history] = await Promise.all([
    query<{ channel: string; when: string; service: string; note: string }>(
      "select channel, happened_at as when, service, note from lead_entries where lead_id = $1 order by created_at desc",
      [row.id],
    ),
    query<{ attempt: number; agent_id: string; agent_name: string; l1: string; l2: string | null; note: string; created_at: string }>(
      "select attempt, agent_id, agent_name, l1, l2, note, created_at from dispositions where lead_id = $1 order by created_at asc",
      [row.id],
    ),
  ]);

  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    leadType: row.lead_type,
    facility: row.facility,
    area: row.area,
    doctor: row.doctor,
    department: row.department,
    patientName: row.patient_name,
    wantDate: row.want_date ?? "",
    preferredTime: row.preferred_time,
    email: row.email,
    note: row.note,
    status: row.status,
    detail: row.detail,
    urgent: row.urgent,
    urgentReason: row.urgent_reason,
    merged: row.merged,
    cohort: row.cohort,
    ownerId: row.owner_id,
    ownerName: row.owner_name,
    createdAt: row.created_at,
    channel: row.channel,
    existing: row.existing_patient,
    attempt: row.attempt,
    entries: entries.rows.map((e) => ({ channel: e.channel, when: e.when, service: e.service, note: e.note })),
    history: history.rows.map((h) => ({
      attempt: h.attempt,
      agentId: h.agent_id,
      agentName: h.agent_name,
      l1: h.l1,
      l2: h.l2,
      note: h.note,
      whenISO: h.created_at,
      when: new Date(h.created_at).toLocaleString(),
    })),
    nextActionDate: row.next_action_date ?? "",
    erpRefType: row.erp_ref_type,
    erpRefValue: row.erp_ref_value,
    escalated: row.escalated,
    escalatedBy: row.escalated_by,
    escalatedAt: row.escalated_at ?? "",
    assignedTo: row.assigned_to ?? "",
    assignedAt: row.assigned_at ?? "",
    claimedBy: row.claimed_by ?? "",
    claimedAt: row.claimed_at ?? "",
  };
}

export function digitsOf(phone: string): string {
  return String(phone || "").replace(/\D/g, "").slice(-10);
}
