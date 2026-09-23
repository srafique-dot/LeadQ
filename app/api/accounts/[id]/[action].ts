import bcrypt from "bcryptjs";
import { query } from "../../_db.js";
import { route, body } from "../../_http.js";
import { generatePassword } from "../../_passwords.js";
import { allow } from "../../_auth.js";

/** reset-password, toggle-active, rename and presence share one function —
 * Vercel Hobby caps a deployment at 12 serverless functions — dispatching
 * on [action]. */
export default route({
  POST: async (req, res, session) => {
    const id = String(req.query.id).toUpperCase();
    const action = String(req.query.action);

    if (action === "presence") {
      // Only your own availability. A superadmin "viewing as" an agent must
      // not be able to put that agent on the floor.
      if (session.employeeId !== id) return void res.status(403).json({ error: "forbidden" });
      const { presence } = body<{ presence: string }>(req);
      if (!["available", "break", "off"].includes(presence)) {
        return void res.status(400).json({ error: "bad_presence" });
      }
      await query("update accounts set presence = $1, presence_at = now() where employee_id = $2", [presence, id]);
      // Stepping away releases the untouched leads held for this agent, so
      // the queue doesn't go cold behind someone who has gone home.
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

    if (!allow(res, session, "superadmin")) return;

    if (action === "reset-password") {
      const password = generatePassword();
      const hash = await bcrypt.hash(password, 10);
      // session_version bump signs them out everywhere: whoever was holding
      // the old password (or a session made with it) loses access now.
      const { rowCount } = await query(
        `update accounts
            set password_hash = $1, must_change_password = true, session_version = session_version + 1,
                failed_logins = 0, locked_until = null
          where employee_id = $2`,
        [hash, id],
      );
      if (!rowCount) return void res.status(404).json({ error: "not_found" });
      return void res.status(200).json({ password });
    }

    if (action === "toggle-active") {
      const { active } = body<{ active: boolean }>(req);
      if (!active && id === session.employeeId) {
        return void res.status(400).json({ error: "cannot_deactivate_self" });
      }
      const { rowCount } = await query(
        `update accounts
            set active = $1,
                session_version = case when $1 then session_version else session_version + 1 end,
                presence = case when $1 then presence else 'off' end
          where employee_id = $2`,
        [active, id],
      );
      if (!rowCount) return void res.status(404).json({ error: "not_found" });
      if (!active) {
        // Hand their untouched work back to the floor right away.
        await query(
          `update leads set assigned_to = null, assigned_at = null, claimed_by = null, claimed_at = null
            where (assigned_to = $1 or claimed_by = $1) and status in ('waiting','trying')`,
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
