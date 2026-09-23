import bcrypt from "bcryptjs";
import { query } from "./_db.js";
import { publicRoute, body } from "./_http.js";
import { serializeAccount, type AccountRow } from "./_accounts.js";
import { setSessionCookie, clearSessionCookie } from "./_auth.js";

interface AuthBody {
  action: "sign-in" | "change-password" | "sign-out";
  employeeId?: string;
  password?: string;
  newPassword?: string;
  stayOnDevice?: boolean;
}

type FullAccountRow = AccountRow & {
  password_hash: string;
  session_version: number;
  failed_logins: number;
  locked_until: string | null;
};

const MAX_FAILED = 5;
const LOCK_MIN = 15;

/** Sign-in, change-password, sign-out and "who am I" share one function —
 * Vercel Hobby caps a deployment at 12 serverless functions. Public because
 * signing in has to work signed out; each action checks what it needs. */
export default publicRoute({
  GET: async (_req, res, session) => {
    if (!session) return void res.status(401).json({ error: "unauthenticated" });
    const { rows } = await query<AccountRow>("select * from accounts where employee_id = $1", [session.employeeId]);
    res.status(200).json(serializeAccount(rows[0]));
  },

  POST: async (req, res, session) => {
    const b = body<AuthBody>(req);

    if (b.action === "sign-out") {
      clearSessionCookie(req, res);
      return void res.status(200).json({ ok: true });
    }

    if (b.action === "change-password") {
      // Only ever your own password, and only with a live session — the
      // session is the proof you just authenticated. A forced change right
      // after signing in with a temporary password is the normal case.
      if (!session) return void res.status(401).json({ ok: false, error: "unauthenticated" });
      const newPassword = b.newPassword ?? "";
      if (newPassword.length < 8) return void res.status(400).json({ ok: false, error: "too_short" });

      const { rows } = await query<{ password_hash: string }>("select password_hash from accounts where employee_id = $1", [
        session.employeeId,
      ]);
      if (await bcrypt.compare(newPassword, rows[0].password_hash)) {
        return void res.status(400).json({ ok: false, error: "same_as_issued" });
      }

      const hash = await bcrypt.hash(newPassword, 10);
      const { rows: updated } = await query<{ session_version: number }>(
        `update accounts set password_hash = $1, must_change_password = false, session_version = session_version + 1
          where employee_id = $2 returning session_version`,
        [hash, session.employeeId],
      );
      // Every other session for this account dies with the old password;
      // this one is re-issued so the person who just changed it stays in.
      setSessionCookie(req, res, session.employeeId, updated[0].session_version, !!b.stayOnDevice);
      return void res.status(200).json({ ok: true });
    }

    // sign-in
    const id = (b.employeeId ?? "").trim().toUpperCase();
    if (!id) return void res.status(400).json({ ok: false, error: "empty_id" });
    if (!b.password) return void res.status(400).json({ ok: false, error: "empty_password" });

    const { rows } = await query<FullAccountRow>("select * from accounts where employee_id = $1", [id]);
    const account = rows[0];
    // Same answer for "no such ID" and "deactivated" so the form can't be
    // used to find out which employee IDs exist.
    if (!account || !account.active) return void res.status(400).json({ ok: false, error: "unknown_id" });

    if (account.locked_until && Date.parse(account.locked_until) > Date.now()) {
      return void res.status(429).json({ ok: false, error: "locked" });
    }

    if (!(await bcrypt.compare(b.password, account.password_hash))) {
      await query(
        `update accounts
            set failed_logins = failed_logins + 1,
                locked_until = case when failed_logins + 1 >= $2 then now() + ($3 || ' minutes')::interval else locked_until end
          where employee_id = $1`,
        [id, MAX_FAILED, LOCK_MIN],
      );
      return void res.status(400).json({ ok: false, error: "wrong_password" });
    }

    await query("update accounts set failed_logins = 0, locked_until = null where employee_id = $1", [id]);
    setSessionCookie(req, res, account.employee_id, account.session_version, !!b.stayOnDevice);
    res.status(200).json({ ok: true, account: serializeAccount(account) });
  },
});
