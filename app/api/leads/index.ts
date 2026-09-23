import { pool, query } from "../_db.js";
import { route, body } from "../_http.js";
import { serializeLead, digitsOf, type LeadRow } from "../_leads.js";
import { releaseStaleAssignments, topUpWorkingSet, assignedSql, borrowableSql, heartbeat, TODAY } from "../_routing.js";

interface NewLeadBody {
  name: string;
  phone: string;
  leadType: string;
  facility: string;
  area: string;
  doctor: string;
  department: string;
  patientName: string;
  wantDate: string;
  preferredTime: string;
  email: string;
  note: string;
  urgent: boolean;
  urgentReason: string;
  cohort: string;
  channel?: string;
}

interface ImportRow {
  name: string;
  phone: string;
  facility: string;
  doctor: string;
  department: string;
  email: string;
  note: string;
  leadType: string;
  wantDate: string;
  preferredTime: string;
  urgent: boolean;
  urgentReason: string;
}

interface ImportBody {
  rows: ImportRow[];
  cohort: string;
  cohortInstructions?: string;
}

const MAX_IMPORT_ROWS = 5000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Handles list/create/find-by-phone/import for leads in one function
 * (Vercel Hobby caps a deployment at 12 serverless functions). GET dispatches
 * on which query param is present; POST dispatches on ?action=.
 *
 * Who sees what: requesters only their own submissions; agents their own
 * queue (plus search across everything, which the call screen needs to find
 * a caller); team leads and the superadmin everything. */
export default route({
  GET: async (req, res, session) => {
    const { ownerId, queue, phone, agentId, search, id } = req.query;

    if (typeof id === "string") {
      const { rows } = await query<LeadRow>("select * from leads where id = $1", [id]);
      const lead = rows[0];
      if (!lead || (session.role === "requester" && lead.owner_id !== session.employeeId)) {
        return void res.status(404).json({ error: "not_found" });
      }
      return void res.status(200).json(await serializeLead(lead));
    }

    if (typeof search === "string") {
      if (session.role === "requester") return void res.status(403).json({ error: "forbidden" });
      const term = search.trim().slice(0, 60);
      const digits = term.replace(/\D/g, "");
      // Name substring, or phone digits when the term looks like a number.
      const { rows } = await query<LeadRow>(
        `select * from leads
          where ($1 = '' or name ilike '%' || $1 || '%' or ($2 <> '' and length($2) >= 4 and digits like '%' || $2 || '%'))
          order by created_at desc limit 20`,
        [term.replace(/[%_\\]/g, ""), digits],
      );
      return void res.status(200).json(await Promise.all(rows.map(serializeLead)));
    }

    if (typeof phone === "string") {
      const digits = digitsOf(phone);
      if (digits.length < 7) return void res.status(200).json(null);
      const { rows } = await query<LeadRow>("select * from leads where digits = $1 order by created_at asc limit 1", [digits]);
      return void res.status(200).json(rows[0] ? await serializeLead(rows[0]) : null);
    }

    if (queue === "1" && typeof agentId === "string") {
      if (session.role === "requester") return void res.status(403).json({ error: "forbidden" });
      // Agents only ever get their own queue. Team leads may look at anyone's.
      const target = session.role === "agent" ? session.employeeId : agentId;
      // Pulling your own queue is the activity signal (see heartbeat). A
      // team lead looking at someone else's queue must not keep them "on
      // the floor" or keep their claims alive.
      if (target === session.employeeId) await heartbeat(target);
      await releaseStaleAssignments();
      await topUpWorkingSet(target);
      const [mine, borrowable] = await Promise.all([
        query<LeadRow>(assignedSql(), [target]),
        query<LeadRow>(borrowableSql(), [target]),
      ]);
      const rows = [...mine.rows, ...borrowable.rows];
      return void res.status(200).json(await Promise.all(rows.map(serializeLead)));
    }

    if (typeof ownerId === "string") {
      const owner = session.role === "requester" ? session.employeeId : ownerId;
      const { rows } = await query<LeadRow>("select * from leads where owner_id = $1 order by created_at desc", [owner]);
      return void res.status(200).json(await Promise.all(rows.map(serializeLead)));
    }

    if (session.role === "requester") return void res.status(403).json({ error: "forbidden" });

    const sql =
      queue === "1"
        ? `select * from leads where status in ('waiting','trying') and not escalated and (next_action_date is null or next_action_date <= ${TODAY}) and (retry_after is null or retry_after <= now()) order by urgent desc, created_at asc`
        : "select * from leads order by created_at desc";
    const { rows } = await query<LeadRow>(sql);
    res.status(200).json(await Promise.all(rows.map(serializeLead)));
  },

  POST: async (req, res, session) => {
    if (req.query.action === "import") {
      const { rows, cohort, cohortInstructions } = body<ImportBody>(req);
      const batch = (cohort ?? "").trim();
      if (!batch) return void res.status(400).json({ error: "missing_cohort" });
      if (!Array.isArray(rows) || rows.length === 0) return void res.status(400).json({ error: "no_rows" });
      if (rows.length > MAX_IMPORT_ROWS) return void res.status(413).json({ error: "too_many_rows", max: MAX_IMPORT_ROWS });

      const candidates = rows
        .map((r) => ({ ...r, name: (r.name ?? "").trim(), phone: (r.phone ?? "").trim(), digits: digitsOf(r.phone) }))
        .filter((r) => r.name && r.digits.length >= 7);

      // One transaction, a handful of statements regardless of file size —
      // a row-at-a-time loop runs past the serverless time limit on a real
      // cohort and leaves half a batch behind when it does.
      const client = await pool.connect();
      try {
        await client.query("begin");
        await client.query(
          `insert into cohorts (name, instructions, created_by)
           values ($1,$2,$3)
           on conflict (name) do update set instructions = case when excluded.instructions <> '' then excluded.instructions else cohorts.instructions end`,
          [batch, cohortInstructions?.trim() ?? "", session.employeeId],
        );

        const { rows: existing } = await client.query<{ id: string; name: string; digits: string }>(
          "select distinct on (digits) id, name, digits from leads where digits = any($1::text[]) order by digits, created_at asc",
          [[...new Set(candidates.map((c) => c.digits))]],
        );
        const existingByDigits = new Map(existing.map((e) => [e.digits, e]));

        const seenInFile = new Map<string, string>();
        const toInsert: typeof candidates = [];
        const duplicates: { row: ImportRow; existing: { id: string; name: string } }[] = [];
        for (const c of candidates) {
          const prior = existingByDigits.get(c.digits);
          if (prior) {
            duplicates.push({ row: c, existing: { id: prior.id, name: prior.name } });
          } else if (seenInFile.has(c.digits)) {
            // The same number twice in one file — keep the first.
            duplicates.push({ row: c, existing: { id: "", name: `${seenInFile.get(c.digits)} (earlier in this file)` } });
          } else {
            seenInFile.set(c.digits, c.name);
            toInsert.push(c);
          }
        }

        let created: { id: string; name: string; phone: string }[] = [];
        if (toInsert.length) {
          const { rows: inserted } = await client.query<{ id: string; name: string; phone: string }>(
            `insert into leads
               (name, phone, facility, doctor, department, email, note, lead_type, want_date, preferred_time,
                status, detail, urgent, urgent_reason, cohort, owner_id, owner_name, channel)
             select t.name, t.phone, t.facility, t.doctor, t.department, t.email, t.note, t.lead_type::lead_type,
                    nullif(t.want_date, '')::date, t.preferred_time, 'waiting',
                    case when t.urgent then 'Urgent · first in the queue · just now' else 'In the queue · just now' end,
                    t.urgent, t.urgent_reason, $13, $14, $15, 'Import'
               from unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[],
                           $8::text[], $9::text[], $10::text[], $11::boolean[], $12::text[])
                    as t(name, phone, facility, doctor, department, email, note, lead_type, want_date, preferred_time, urgent, urgent_reason)
             returning id, name, phone`,
            [
              toInsert.map((r) => r.name),
              toInsert.map((r) => r.phone),
              toInsert.map((r) => r.facility ?? ""),
              toInsert.map((r) => r.doctor ?? ""),
              toInsert.map((r) => r.department ?? ""),
              toInsert.map((r) => r.email ?? ""),
              toInsert.map((r) => r.note ?? ""),
              toInsert.map((r) => r.leadType || "general_inquiry"),
              toInsert.map((r) => (ISO_DATE.test(r.wantDate ?? "") ? r.wantDate : "")),
              toInsert.map((r) => r.preferredTime ?? ""),
              toInsert.map((r) => !!r.urgent),
              toInsert.map((r) => r.urgentReason ?? ""),
              batch,
              session.employeeId,
              session.name,
            ],
          );
          created = inserted;
        }

        await client.query("commit");
        return void res.status(200).json({ created, duplicates, skipped: rows.length - candidates.length });
      } catch (err) {
        await client.query("rollback").catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    }

    const b = body<NewLeadBody>(req);
    const name = (b.name ?? "").trim();
    const phone = (b.phone ?? "").trim();
    if (!name) return void res.status(400).json({ error: "missing_name" });
    if (digitsOf(phone).length < 7) return void res.status(400).json({ error: "bad_phone" });

    const detail = b.urgent ? "Urgent · first in the queue · just now" : "In the queue · just now";
    const { rows } = await query<LeadRow>(
      `insert into leads
         (name, phone, lead_type, facility, area, doctor, department, patient_name, want_date, preferred_time, email, note,
          status, detail, urgent, urgent_reason, cohort, owner_id, owner_name, channel)
       values ($1,$2,$3,$4,$5,$6,$7,$8,nullif($9,'')::date,$10,$11,$12,'waiting',$13,$14,$15,$16,$17,$18,$19)
       returning *`,
      [
        name,
        phone,
        b.leadType || "appointment",
        b.facility ?? "",
        b.area?.trim() ?? "",
        b.doctor?.trim() ?? "",
        b.department?.trim() ?? "",
        b.patientName?.trim() ?? "",
        ISO_DATE.test(b.wantDate ?? "") ? b.wantDate : "",
        b.preferredTime ?? "",
        b.email?.trim() ?? "",
        b.note?.trim() ?? "",
        detail,
        !!b.urgent,
        b.urgentReason?.trim() ?? "",
        b.cohort ?? "",
        session.employeeId,
        session.name,
        b.channel || "Manual entry",
      ],
    );
    res.status(201).json(await serializeLead(rows[0]));
  },
});
