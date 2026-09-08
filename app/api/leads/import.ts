import { query } from "../_db";
import { route, body } from "../_http";
import { serializeLead, digitsOf, type LeadRow } from "../_leads";

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

export default route({
  POST: async (req, res) => {
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

    res.status(200).json({ created, duplicates });
  },
});
