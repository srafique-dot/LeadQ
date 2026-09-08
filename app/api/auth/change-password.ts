import bcrypt from "bcryptjs";
import { query } from "../_db";
import { route, body } from "../_http";

interface ChangePasswordBody {
  employeeId: string;
  newPassword: string;
}

export default route({
  POST: async (req, res) => {
    const { employeeId, newPassword } = body<ChangePasswordBody>(req);
    const id = (employeeId ?? "").trim().toUpperCase();
    if (newPassword.length < 8) return void res.status(400).json({ ok: false, error: "too_short" });

    const { rows } = await query<{ password_hash: string }>("select password_hash from accounts where employee_id = $1", [id]);
    if (!rows[0]) return void res.status(404).json({ ok: false, error: "not_found" });

    const sameAsIssued = await bcrypt.compare(newPassword, rows[0].password_hash);
    if (sameAsIssued) return void res.status(400).json({ ok: false, error: "same_as_issued" });

    const hash = await bcrypt.hash(newPassword, 10);
    await query("update accounts set password_hash = $1, must_change_password = false where employee_id = $2", [hash, id]);
    res.status(200).json({ ok: true });
  },
});
