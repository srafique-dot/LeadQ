import bcrypt from "bcryptjs";
import { query } from "../_db";
import { route, body } from "../_http";

const ROLE_LABEL: Record<string, string> = {
  requester: "Business development",
  agent: "Call centre agent",
  admin: "Team lead",
  superadmin: "Superadmin",
};

interface SignInBody {
  employeeId: string;
  password: string;
}

export default route({
  POST: async (req, res) => {
    const { employeeId, password } = body<SignInBody>(req);
    const id = (employeeId ?? "").trim().toUpperCase();
    if (!id) return void res.status(400).json({ ok: false, error: "empty_id" });

    const { rows } = await query<{
      employee_id: string;
      name: string;
      role: string;
      password_hash: string;
      must_change_password: boolean;
      calling_number: string;
      active: boolean;
      facility: string;
    }>("select * from accounts where employee_id = $1", [id]);
    const account = rows[0];
    if (!account || !account.active) return void res.status(400).json({ ok: false, error: "unknown_id" });
    if (!password) return void res.status(400).json({ ok: false, error: "empty_password" });

    const matches = await bcrypt.compare(password, account.password_hash);
    if (!matches) return void res.status(400).json({ ok: false, error: "wrong_password" });

    res.status(200).json({
      ok: true,
      account: {
        employeeId: account.employee_id,
        name: account.name,
        role: account.role,
        roleLabel: ROLE_LABEL[account.role] ?? account.role,
        mustChangePassword: account.must_change_password,
        callingNumber: account.calling_number,
        active: account.active,
        facility: account.facility,
      },
    });
  },
});
