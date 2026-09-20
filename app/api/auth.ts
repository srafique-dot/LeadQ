import bcrypt from "bcryptjs";
import { query } from "./_db.js";
import { route, body } from "./_http.js";
import { serializeAccount, type AccountRow } from "./_accounts.js";

interface AuthBody {
  action: "sign-in" | "change-password";
  employeeId: string;
  password?: string;
  newPassword?: string;
}

/** Combines sign-in and change-password into one function — Vercel Hobby
 * caps a deployment at 12 serverless functions, so related actions share a
 * file and dispatch on `action` instead of each getting its own route. */
export default route({
  POST: async (req, res) => {
    const b = body<AuthBody>(req);
    const id = (b.employeeId ?? "").trim().toUpperCase();

    if (b.action === "change-password") {
      const newPassword = b.newPassword ?? "";
      if (newPassword.length < 8) return void res.status(400).json({ ok: false, error: "too_short" });

      const { rows } = await query<{ password_hash: string }>("select password_hash from accounts where employee_id = $1", [id]);
      if (!rows[0]) return void res.status(404).json({ ok: false, error: "not_found" });

      const sameAsIssued = await bcrypt.compare(newPassword, rows[0].password_hash);
      if (sameAsIssued) return void res.status(400).json({ ok: false, error: "same_as_issued" });

      const hash = await bcrypt.hash(newPassword, 10);
      await query("update accounts set password_hash = $1, must_change_password = false where employee_id = $2", [hash, id]);
      return void res.status(200).json({ ok: true });
    }

    // default: sign-in
    if (!id) return void res.status(400).json({ ok: false, error: "empty_id" });
    const { rows } = await query<AccountRow & { password_hash: string }>("select * from accounts where employee_id = $1", [id]);
    const account = rows[0];
    if (!account || !account.active) return void res.status(400).json({ ok: false, error: "unknown_id" });
    if (!b.password) return void res.status(400).json({ ok: false, error: "empty_password" });

    const matches = await bcrypt.compare(b.password, account.password_hash);
    if (!matches) return void res.status(400).json({ ok: false, error: "wrong_password" });

    res.status(200).json({ ok: true, account: serializeAccount(account) });
  },
});
