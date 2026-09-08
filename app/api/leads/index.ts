import { query } from "../_db";
import { route, body } from "../_http";
import { serializeLead, type LeadRow } from "../_leads";

interface NewLeadBody {
  name: string;
  phone: string;
  facility: string;
  area: string;
  doctor: string;
  department: string;
  patientName: string;
  wantDate: string;
  note: string;
  urgent: boolean;
  urgentReason: string;
  cohort: string;
  ownerId: string;
  ownerName: string;
  channel?: string;
}

export default route({
  GET: async (req, res) => {
    const { ownerId, queue } = req.query;
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
    const b = body<NewLeadBody>(req);
    const detail = b.urgent ? "Urgent · first in the queue · just now" : "In the queue · just now";
    const { rows } = await query<LeadRow>(
      `insert into leads
         (name, phone, facility, area, doctor, department, patient_name, want_date, note,
          status, detail, urgent, urgent_reason, cohort, owner_id, owner_name, channel)
       values ($1,$2,$3,$4,$5,$6,$7,nullif($8,'')::date,$9,'waiting',$10,$11,$12,$13,$14,$15,$16)
       returning *`,
      [
        b.name.trim(),
        b.phone.trim(),
        b.facility,
        b.area?.trim() ?? "",
        b.doctor?.trim() ?? "",
        b.department?.trim() ?? "",
        b.patientName?.trim() ?? "",
        b.wantDate ?? "",
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
