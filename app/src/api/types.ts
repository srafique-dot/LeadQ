export type Role = "requester" | "agent" | "admin" | "superadmin";

/** Declared by the agent, never inferred from activity — the app has no way
 * to see whether someone is actually on a call. */
export type Presence = "available" | "break" | "off";

export interface Account {
  employeeId: string;
  name: string;
  email: string;
  role: Role;
  roleLabel: string;
  mustChangePassword: boolean;
  /** Desk extension or mobile they dial from. Required to match them against
   * a monthly CDR export, which carries no names. */
  callingNumber: string;
  active: boolean;
  facility: string;
  presence: Presence;
  /** A requester's usual lead source — pre-fills their Add-lead form.
   * Empty means they pick a channel on every lead, same as before this
   * existed. Meaningless for non-requester roles. */
  defaultChannel: string;
}

/** A superadmin-issued invite: role/facility/calling number are fixed by
 * whoever creates it, the invitee only supplies their own identity. */
export interface Invite {
  token: string;
  role: Role;
  roleLabel: string;
  facility: string;
  callingNumber: string;
  defaultChannel: string;
  createdBy: string;
  createdAt: string;
  usedAt: string;
  usedByName: string;
}

export type LeadStatus = "waiting" | "trying" | "booked" | "closed";

export type LeadType =
  | "appointment"
  | "vaccine_query"
  | "lab_test"
  | "radiology"
  | "investigative_procedure"
  | "surgery_package"
  | "health_package"
  | "corporate_health"
  | "therapy"
  | "dialysis"
  | "ipd"
  | "day_care"
  | "international_patient"
  | "general_inquiry";

export type Level1Code = "connected" | "not_responding" | "busy" | "number_off" | "invalid_number" | "call_rejected" | "international";
export type Level2Code =
  | "appointment_purchased"
  | "appointment_booked"
  | "info_given"
  | "callback_later"
  | "ni_price"
  | "ni_distance"
  | "ni_elsewhere"
  | "wrong_person"
  | "duplicate"
  | "already_handled";

export interface DispositionRecord {
  attempt: number;
  when: string;
  whenISO: string;
  agentId: string;
  agentName: string;
  l1: Level1Code;
  l2: Level2Code | null;
  note: string;
}

/** A superadmin-managed "how did this lead come in" option — free text,
 * not an enum, so adding one is an app action, not a schema change. */
export interface Channel {
  name: string;
  active: boolean;
  createdBy: string;
  createdAt: string;
}

export interface MergedEntry {
  channel: string;
  when: string;
  service: string;
  note: string;
}

export interface Lead {
  id: string;
  name: string;
  phone: string;
  leadType: LeadType;
  facility: string;
  area: string;
  doctor: string;
  department: string;
  patientName: string;
  wantDate: string;
  preferredTime: string;
  email: string;
  note: string;
  status: LeadStatus;
  detail: string;
  urgent: boolean;
  urgentReason: string;
  merged: boolean;
  cohort: string;
  ownerId: string;
  ownerName: string;
  createdAt: string;
  channel: string;
  existing: boolean;
  attempt: number;
  history: DispositionRecord[];
  entries: MergedEntry[];
  nextActionDate: string;
  erpRefType: "booking" | "invoice" | "";
  erpRefValue: string;
  escalated: boolean;
  escalatedBy: string;
  escalatedAt: string;
  escalatedReason: string;
  /** ISO time a failed attempt is held out of the queue until; "" if not held. */
  retryAfter: string;
  /** The agent this lead is routed to. Sticky to whoever last logged an
   * outcome, so follow-ups go back to the person who already spoke to them. */
  assignedTo: string;
  assignedAt: string;
  /** Short-lived "on this call right now" lock. Held by someone other than
   * assignedTo means they're covering it as a one-time loan. */
  claimedBy: string;
  claimedAt: string;
}

export interface NewLeadInput {
  name: string;
  phone: string;
  leadType: LeadType;
  facility: string;
  area: string;
  doctor: string;
  department: string;
  patientName: string;
  wantDate: string;
  preferredTime: string;
  email: string;
  note: string;
  urgent: boolean;
  urgentReason: string;
  cohort: string;
}
