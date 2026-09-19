import { query } from "../_db.js";
import { route, body } from "../_http.js";
import { serializeLead, digitsOf, type LeadRow } from "../_leads.js";

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
  ownerId: string;
  ownerName: string;
  channel?: string;
}

interface ImportRow {
  name: string;
  phone: string;
  facility: string;
  doctorOrDept: string;
}

interface ImportBody {
  rows: ImportRow[];
  cohort: string;
  ownerId: string;
  ownerName: string;
}

/** Handles list/create/find-by-phone/import for leads in one function
 * (Vercel Hobby caps a deployment at 12 serverless functions). GET dispatches
 * on which query param is present; POST dispatches on ?action=. */
export default route({
  GET: async (req, res) => {
    const { ownerId, queue, phone } = req.query;

    if (typeof phone === "string") {
      const digits = digitsOf(phone);
      if (digits.length < 7) return void res.status(200).json(null);
      const { rows } = await query<LeadRow>("select * from leads where digits = $1 limit 1", [digits]);
      return void res.status(200).json(rows[0] ? await serializeLead(rows[0]) : null);
    }

    let sql = "select * from leads";
    const params: unknown[] = [];
    if (typeof ownerId === "string") {
      sql += " where owner_id = $1 order by created_at desc";
      params.push(ownerId);
    } else if (queue === "1") {
      sql +=
        " where status in ('waiting','trying') and not escalated and (next_action_date is null or next_action_date <= current_date)" +
        " order by urgent desc, created_at asc";
    } else {
      sql += " order by created_at desc";
    }
    const { rows } = await query<LeadRow>(sql, params);
    res.status(200).json(await Promise.all(rows.map(serializeLead)));
  },

  POST: async (req, res) => {
    if (req.query.action === "import") {
      const { rows, cohort, ownerId, ownerName } = body<ImportBody>(req);
      const created: unknown[] = [];
      const duplicates: { row: ImportRow; existing: unknown }[] = [];
      for (const row of rows) {
        const digits = digitsOf(row.phone);
        const { rows: existingRows } = await query<LeadRow>("select * from leads where digits = $1 limit 1", [digits]);
        if (existingRows[0]) {
          duplicates.push({ row, existing: await serializeLead(existingRows[0]) });
          continue;
        }
        const { rows: inserted } = await query<LeadRow>(
          `insert into leads (name, phone, facility, doctor, status, detail, cohort, owner_id, owner_name, channel)
           values ($1,$2,$3,$4,'waiting','In the queue · just now',$5,$6,$7,'Import')
           returning *`,
          [row.name, row.phone, row.facility, row.doctorOrDept, cohort, ownerId, ownerName],
        );
        created.push(await serializeLead(inserted[0]));
      }
      return void res.status(200).json({ created, duplicates });
    }

    const b = body<NewLeadBody>(req);
    const detail = b.urgent ? "Urgent · first in the queue · just now" : "In the queue · just now";
    const { rows } = await query<LeadRow>(
      `insert into leads
         (name, phone, lead_type, facility, area, doctor, department, patient_name, want_date, preferred_time, email, note,
          status, detail, urgent, urgent_reason, cohort, owner_id, owner_name, channel)
       values ($1,$2,$3,$4,$5,$6,$7,$8,nullif($9,'')::date,$10,$11,$12,'waiting',$13,$14,$15,$16,$17,$18,$19)
       returning *`,
      [
        b.name.trim(),
        b.phone.trim(),
        b.leadType ?? "appointment",
        b.facility,
        b.area?.trim() ?? "",
        b.doctor?.trim() ?? "",
        b.department?.trim() ?? "",
        b.patientName?.trim() ?? "",
        b.wantDate ?? "",
        b.preferredTime ?? "",
        b.email?.trim() ?? "",
        b.note?.trim() ?? "",
        detail,
        b.urgent,
        b.urgentReason?.trim() ?? "",
        b.cohort ?? "",
        b.ownerId,
        b.ownerName,
        b.channel ?? "Manual entry",
      ],
    );
    res.status(201).json(await serializeLead(rows[0]));
  },
});
