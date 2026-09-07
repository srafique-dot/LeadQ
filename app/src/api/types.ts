export type Role = "requester" | "agent" | "admin" | "superadmin";

export interface Account {
  employeeId: string;
  name: string;
  role: Role;
  roleLabel: string;
  /** Mock-only plaintext password. A real backend hashes this one-way and
   * never returns it — the UI's promise ("nobody can read it back") holds
   * here too: nothing in this module exposes an existing password, only
   * verify/set operations. */
  password: string;
  mustChangePassword: boolean;
}

export type LeadStatus = "waiting" | "trying" | "booked" | "closed";

export interface Lead {
  id: string;
  name: string;
  phone: string;
  facility: string;
  area: string;
  doctor: string;
  department: string;
  patientName: string;
  wantDate: string;
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
}

export interface NewLeadInput {
  name: string;
  phone: string;
  facility: string;
  area: string;
  doctor: string;
  department: string;
  patientName: string;
  wantDate: string;
  note: string;
  urgent: boolean;
  urgentReason: string;
  cohort: string;
}
