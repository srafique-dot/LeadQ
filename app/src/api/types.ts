export type Role = "requester" | "agent" | "admin" | "superadmin";

export interface Account {
  employeeId: string;
  name: string;
  role: Role;
  roleLabel: string;
  mustChangePassword: boolean;
  /** Desk extension or mobile they dial from. Required to match them against
   * a monthly CDR export, which carries no names. */
  callingNumber: string;
  active: boolean;
  facility: string;
}

export type LeadStatus = "waiting" | "trying" | "booked" | "closed";

export type LeadType = "appointment" | "surgery_package" | "health_package" | "international_patient" | "general_inquiry";

export type Level1Code = "connected" | "not_responding" | "busy" | "number_off" | "invalid_number" | "call_rejected";
export type Level2Code =
  | "appointment_purchased"
  | "appointment_booked"
  | "info_given"
  | "callback_later"
  | "ni_price"
  | "ni_distance"
  | "ni_elsewhere"
  | "wrong_person"
  | "duplicate";

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
