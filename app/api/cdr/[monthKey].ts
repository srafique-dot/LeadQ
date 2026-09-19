import { query } from "../_db.js";
import { route, body } from "../_http.js";

interface CdrRowInput {
  extension: string;
  numberDialled: string;
  startTime: string;
  durationSec: number;
  connected: boolean;
}

export default route({
  GET: async (req, res) => {
    const monthKey = String(req.query.monthKey);
    const { rows: uploads } = await query<{ file_name: string; uploaded_by: string; uploaded_at: string }>(
      "select file_name, uploaded_by, uploaded_at from cdr_uploads where month_key = $1",
      [monthKey],
    );
    if (!uploads[0]) return void res.status(200).json(null);

    const [y, m] = monthKey.split("-").map(Number);
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
         count(c.*) filter (where c.extension = a.calling_number)::text as dials,
         count(c.*) filter (where c.extension = a.calling_number and c.connected)::text as connected,
         coalesce(sum(c.duration_sec) filter (where c.extension = a.calling_number and c.connected), 0)::text as talk_sec,
         (select count(*) from dispositions d
            where d.agent_id = a.employee_id and d.l2 in ('appointment_booked','appointment_purchased')
              and extract(year from d.created_at) = $2 and extract(month from d.created_at) = $3)::text as booked,
         (select count(*) from dispositions d
            where d.agent_id = a.employee_id and d.l1 = 'connected'
              and extract(year from d.created_at) = $2 and extract(month from d.created_at) = $3)::text as logged_connected
       from accounts a
       left join cdr_rows c on c.month_key = $1
       where a.role = 'agent'
       group by a.employee_id, a.name`,
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

  POST: async (req, res) => {
    const monthKey = String(req.query.monthKey);
    const { fileName, uploadedBy, rows } = body<{ fileName: string; uploadedBy: string; rows: CdrRowInput[] }>(req);

    const perExt = new Map<string, number>();
    for (const r of rows) perExt.set(r.extension, (perExt.get(r.extension) ?? 0) + 1);
    const sum = Array.from(perExt.values()).reduce((n, v) => n + v, 0);
    if (sum !== rows.length) return void res.status(400).json({ error: "integrity_check_failed" });

    await query("delete from cdr_rows where month_key = $1", [monthKey]);
    await query(
      `insert into cdr_uploads (month_key, file_name, uploaded_by)
       values ($1,$2,$3)
       on conflict (month_key) do update set file_name = excluded.file_name, uploaded_by = excluded.uploaded_by, uploaded_at = now()`,
      [monthKey, fileName, uploadedBy],
    );
    for (const r of rows) {
      await query("insert into cdr_rows (month_key, extension, number_dialled, start_time, duration_sec, connected) values ($1,$2,$3,$4,$5,$6)", [
        monthKey,
        r.extension,
        r.numberDialled,
        r.startTime,
        r.durationSec,
        r.connected,
      ]);
    }
    res.status(200).json({ ok: true, count: rows.length });
  },
});
