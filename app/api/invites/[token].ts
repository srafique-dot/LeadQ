import bcrypt from "bcryptjs";
import { pool, query } from "../_db.js";
import { publicRoute, body } from "../_http.js";
import { serializeAccount, type AccountRow } from "../_accounts.js";
import { setSessionCookie } from "../_auth.js";

const ROLE_LABEL: Record<string, string> = {
  requester: "Business development",
  agent: "Call centre agent",
  admin: "Team lead",
  superadmin: "Superadmin",
};

interface InviteRow {
  token: string;
  role: string;
  facility: string;
  calling_number: string;
  used_at: string | null;
}

interface ClaimBody {
  firstName: string;
  lastName: string;
  eid: string;
  email: string;
  password: string;
  stayOnDevice?: boolean;
}

/** Public: the person opening an invite link has no account yet. The token
 * itself is the credential — 128 random bits, single use. */
export default publicRoute({
  GET: async (req, res) => {
    const token = String(req.query.token);
    const { rows } = await query<InviteRow>("select token, role, facility, calling_number, used_at from invites where token = $1", [token]);
    const invite = rows[0];
    if (!invite || invite.used_at) return void res.status(200).json(null);
    res.status(200).json({ role: invite.role, roleLabel: ROLE_LABEL[invite.role] ?? invite.role, facility: invite.facility });
  },

  POST: async (req, res) => {
    const token = String(req.query.token);
    const b = body<ClaimBody>(req);

    const firstName = (b.firstName ?? "").trim();
    const lastName = (b.lastName ?? "").trim();
    const eid = (b.eid ?? "").trim();
    const password = b.password ?? "";

    if (!firstName || !lastName) return void res.status(400).json({ error: "missing_name" });
    if (password.length < 8) return void res.status(400).json({ error: "too_short" });

    const employeeId = `${firstName.toUpperCase()}_${eid}`;
    if (!/^[A-Za-z]{2,}_\d{2,6}$/.test(employeeId)) return void res.status(400).json({ error: "invalid_id" });

    const hash = await bcrypt.hash(password, 10);
    const name = `${firstName} ${lastName}`.trim();

    // Row-locked so two people opening the same link at the same moment
    // can't both pass the "unused" check and each get an account.
    const client = await pool.connect();
    try {
      await client.query("begin");
      const { rows: inviteRows } = await client.query<InviteRow>(
        "select token, role, facility, calling_number, used_at from invites where token = $1 for update",
        [token],
      );
      const invite = inviteRows[0];
      if (!invite) {
        await client.query("rollback");
        return void res.status(404).json({ error: "invalid_token" });
      }
      if (invite.used_at) {
        await client.query("rollback");
        return void res.status(400).json({ error: "already_used" });
      }

      const { rows } = await client.query<AccountRow & { session_version: number }>(
        `insert into accounts (employee_id, name, email, role, password_hash, must_change_password, calling_number, facility)
         values ($1,$2,$3,$4,$5,false,$6,$7)
         returning employee_id, name, email, role, must_change_password, calling_number, active, facility, presence, session_version`,
        [employeeId, name, (b.email ?? "").trim(), invite.role, hash, invite.calling_number, invite.facility],
      );
      await client.query("update invites set used_at = now(), used_by = $1 where token = $2", [employeeId, token]);
      await client.query("commit");

      setSessionCookie(req, res, employeeId, rows[0].session_version, !!b.stayOnDevice);
      res.status(201).json({ ok: true, account: serializeAccount(rows[0]) });
    } catch (err: unknown) {
      await client.query("rollback").catch(() => undefined);
      if (err && typeof err === "object" && "code" in err && err.code === "23505") {
        return void res.status(409).json({ error: "id_taken" });
      }
      throw err;
    } finally {
      client.release();
    }
  },
});
