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

    if (action === "presence") {
      const { presence } = body<{ presence: string }>(req);
      if (!["available", "break", "off"].includes(presence)) {
        return void res.status(400).json({ error: "bad_presence" });
      }
      // Stepping away releases the untouched leads held for this agent, so
      // the queue doesn't go cold behind someone who has gone home.
      const { rowCount } = await query(
        "update accounts set presence = $1, presence_at = now() where employee_id = $2",
        [presence, id],
      );
      if (!rowCount) return void res.status(404).json({ error: "not_found" });
      if (presence !== "available") {
        await query(
          `update leads l
              set assigned_to = null, assigned_at = null
            where l.assigned_to = $1
              and l.claimed_by is null
              and l.status in ('waiting','trying')
              and not exists (
                select 1 from dispositions d where d.lead_id = l.id and d.agent_id = $1
              )`,
          [id],
        );
      }
      return void res.status(200).json({ ok: true });
    }

    if (action === "rename") {
      const { name } = body<{ name: string }>(req);
      const trimmed = name?.trim();
      if (!trimmed) return void res.status(400).json({ error: "empty_name" });
      const { rowCount } = await query("update accounts set name = $1 where employee_id = $2", [trimmed, id]);
      if (!rowCount) return void res.status(404).json({ error: "not_found" });
      return void res.status(200).json({ ok: true });
    }

    res.status(404).json({ error: "unknown_action" });
  },
});
