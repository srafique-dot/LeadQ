import bcrypt from "bcryptjs";
import { query } from "../../_db.js";
import { route, body } from "../../_http.js";
import { generatePassword } from "../../_passwords.js";

/** reset-password and toggle-active share one function — Vercel Hobby caps
 * a deployment at 12 serverless functions — dispatching on [action]. */
export default route({
  POST: async (req, res) => {
    const id = String(req.query.id).toUpperCase();
    const action = String(req.query.action);

    if (action === "reset-password") {
      const password = generatePassword();
      const hash = await bcrypt.hash(password, 10);
      const { rowCount } = await query("update accounts set password_hash = $1, must_change_password = true where employee_id = $2", [hash, id]);
      if (!rowCount) return void res.status(404).json({ error: "not_found" });
      return void res.status(200).json({ password });
    }

    if (action === "toggle-active") {
      const { active } = body<{ active: boolean }>(req);
      const { rowCount } = await query("update accounts set active = $1 where employee_id = $2", [active, id]);
      if (!rowCount) return void res.status(404).json({ error: "not_found" });
      return void res.status(200).json({ ok: true });
    }

    res.status(404).json({ error: "unknown_action" });
  },
});
