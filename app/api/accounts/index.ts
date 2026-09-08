import bcrypt from "bcryptjs";
import { query } from "../_db";
import { route, body } from "../_http";
import { generatePassword } from "../_passwords";

const ROLE_LABEL: Record<string, string> = {
  requester: "Business development",
  agent: "Call centre agent",
  admin: "Team lead",
  superadmin: "Superadmin",
};

interface AccountRow {
  employee_id: string;
  name: string;
  role: string;
  must_change_password: boolean;
  calling_number: string;
  active: boolean;
  facility: string;
}

function serialize(a: AccountRow) {
  return {
    employeeId: a.employee_id,
    name: a.name,
    role: a.role,
    roleLabel: ROLE_LABEL[a.role] ?? a.role,
    mustChangePassword: a.must_change_password,
    callingNumber: a.calling_number,
    active: a.active,
    facility: a.facility,
  };
}

interface NewAccountBody {
  employeeId: string;
  name: string;
  role: string;
  facility: string;
  callingNumber: string;
}

export default route({
  GET: async (_req, res) => {
    const { rows } = await query<AccountRow>("select employee_id, name, role, must_change_password, calling_number, active, facility from accounts order by created_at desc");
    res.status(200).json(rows.map(serialize));
  },

  POST: async (req, res) => {
    const b = body<NewAccountBody>(req);
    const id = b.employeeId.trim().toUpperCase();
    if (!/^[A-Za-z]{2}-\d{3}$/.test(id)) return void res.status(400).json({ error: "invalid_id" });

    const password = generatePassword();
    const hash = await bcrypt.hash(password, 10);
    try {
      const { rows } = await query<AccountRow>(
        `insert into accounts (employee_id, name, role, password_hash, calling_number, facility)
         values ($1,$2,$3,$4,$5,$6)
         returning employee_id, name, role, must_change_password, calling_number, active, facility`,
        [id, b.name.trim(), b.role, hash, b.callingNumber.trim(), b.facility],
      );
      res.status(201).json({ account: serialize(rows[0]), password });
    } catch (err: unknown) {
      if (err && typeof err === "object" && "code" in err && err.code === "23505") {
        return void res.status(409).json({ error: "id_taken" });
      }
      throw err;
    }
  },
});
