import { pool, query } from "../_db.js";
import { route, body } from "../_http.js";
import { allow } from "../_auth.js";

/** Sent as parallel columns rather than an array of row objects: repeating
 * five key names on every one of ~40k rows would put a busy month past
 * Vercel's 4.5 MB request-body limit. Columnar it's roughly 2 MB. */
interface CdrUpload {
  fileName: string;
  extension: string[];
  numberDialled: string[];
  startTime: string[];
  durationSec: number[];
  connected: boolean[];
}

const MONTH_KEY = /^\d{4}-(0[1-9]|1[0-2])$/;
/** Well above a busy month for a floor this size (10 agents × 150 dials ×
 * 26 days ≈ 39k), and still under the body limit in columnar form. */
const MAX_ROWS = 60000;

export default route({
  GET: async (req, res, session) => {
    if (!allow(res, session, "admin", "superadmin")) return;
    const monthKey = String(req.query.monthKey);
    if (!MONTH_KEY.test(monthKey)) return void res.status(400).json({ error: "bad_month" });

    const { rows: uploads } = await query<{ file_name: string; uploaded_by: string; uploaded_at: string }>(
      "select file_name, uploaded_by, uploaded_at from cdr_uploads where month_key = $1",
      [monthKey],
    );
    if (!uploads[0]) return void res.status(200).json(null);

    const [y, m] = monthKey.split("-").map(Number);
    // Joined on the agent's own extension, so each agent only ever meets
    // their own calls — not every call in the month, filtered afterwards.
    const { rows: perAgent } = await query<{
      employee_id: string;
      name: string;
      dials: string;
      connected: string;
      talk_sec: string;
      booked: string;
      logged_connected: string;
    }>(
      `select a.employee_id, a.name,
         count(c.id)::text as dials,
         count(c.id) filter (where c.connected)::text as connected,
         coalesce(sum(c.duration_sec) filter (where c.connected), 0)::text as talk_sec,
         (select count(*) from dispositions d
            where d.agent_id = a.employee_id and d.l2 in ('appointment_booked','appointment_purchased')
              and extract(year from d.created_at at time zone 'Asia/Dhaka') = $2
              and extract(month from d.created_at at time zone 'Asia/Dhaka') = $3)::text as booked,
         (select count(*) from dispositions d
            where d.agent_id = a.employee_id and d.l1 = 'connected'
              and extract(year from d.created_at at time zone 'Asia/Dhaka') = $2
              and extract(month from d.created_at at time zone 'Asia/Dhaka') = $3)::text as logged_connected
       from accounts a
       left join cdr_rows c on c.month_key = $1 and a.calling_number <> '' and c.extension = a.calling_number
       where a.role = 'agent'
       group by a.employee_id, a.name
       order by a.name`,
      [monthKey, y, m],
    );

    res.status(200).json({
      fileName: uploads[0].file_name,
      uploadedBy: uploads[0].uploaded_by,
      uploadedAt: uploads[0].uploaded_at,
      perAgent: perAgent.map((r) => ({
        id: r.employee_id,
        name: r.name,
        dials: Number(r.dials),
        connected: Number(r.connected),
        talkSec: Number(r.talk_sec),
        booked: Number(r.booked),
        missing: Math.max(0, Number(r.connected) - Number(r.logged_connected)),
      })),
    });
  },

  POST: async (req, res, session) => {
    if (!allow(res, session, "admin", "superadmin")) return;
    const monthKey = String(req.query.monthKey);
    if (!MONTH_KEY.test(monthKey)) return void res.status(400).json({ error: "bad_month" });

    const u = body<CdrUpload>(req);
    const n = Array.isArray(u.extension) ? u.extension.length : 0;
    if (n === 0) return void res.status(400).json({ error: "no_rows" });
    if (n > MAX_ROWS) return void res.status(413).json({ error: "too_many_rows", max: MAX_ROWS });
    const columns = [u.numberDialled, u.startTime, u.durationSec, u.connected];
    if (columns.some((c) => !Array.isArray(c) || c.length !== n)) {
      return void res.status(400).json({ error: "integrity_check_failed" });
    }

    // All-or-nothing: the old month's rows, the upload record and the new
    // rows land together or not at all. One bulk insert rather than one
    // statement per call, which ran past the serverless time limit on a real
    // month and left a half-loaded file marked as complete.
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("delete from cdr_rows where month_key = $1", [monthKey]);
      await client.query(
        `insert into cdr_uploads (month_key, file_name, uploaded_by)
         values ($1,$2,$3)
         on conflict (month_key) do update set file_name = excluded.file_name, uploaded_by = excluded.uploaded_by, uploaded_at = now()`,
        [monthKey, String(u.fileName ?? "").slice(0, 200), `${session.employeeId} ${session.name}`],
      );
      await client.query(
        `insert into cdr_rows (month_key, extension, number_dialled, start_time, duration_sec, connected)
         select $1, t.extension, t.number_dialled, t.start_time, t.duration_sec, t.connected
           from unnest($2::text[], $3::text[], $4::text[], $5::int[], $6::boolean[])
                as t(extension, number_dialled, start_time, duration_sec, connected)`,
        [
          monthKey,
          u.extension.map((v) => String(v ?? "").trim()),
          u.numberDialled.map((v) => String(v ?? "").trim()),
          u.startTime.map((v) => String(v ?? "").trim()),
          u.durationSec.map((v) => Math.max(0, Math.round(Number(v) || 0))),
          u.connected.map((v) => !!v),
        ],
      );
      await client.query("commit");
      res.status(200).json({ ok: true, count: n });
    } catch (err) {
      await client.query("rollback").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  },
});
