const ROLE_LABEL: Record<string, string> = {
  requester: "Business development",
  agent: "Call centre agent",
  admin: "Team lead",
  superadmin: "Superadmin",
};

export interface AccountRow {
  employee_id: string;
  name: string;
  email: string;
  role: string;
  must_change_password: boolean;
  calling_number: string;
  active: boolean;
  facility: string;
}

export function serializeAccount(a: AccountRow) {
  return {
    employeeId: a.employee_id,
    name: a.name,
    email: a.email,
    role: a.role,
    roleLabel: ROLE_LABEL[a.role] ?? a.role,
    mustChangePassword: a.must_change_password,
    callingNumber: a.calling_number,
    active: a.active,
    facility: a.facility,
  };
}
