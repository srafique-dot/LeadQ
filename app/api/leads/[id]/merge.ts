import { query } from "../../_db";
import { route, body } from "../../_http";
import { serializeLead, type LeadRow } from "../../_leads";

interface MergeBody {
  entry?: { channel: string; service: string; note: string };
}

export default route({
  POST: async (req, res) => {
    const id = String(req.query.id);
    const { entry } = body<MergeBody>(req);

    const { rows: existingEntries } = await query<{ count: string }>("select count(*)::text from lead_entries where lead_id = $1", [id]);
    if (Number(existingEntries[0].count) === 0) {
      // First merge: snapshot the lead's own original enquiry as entry 0 first.
      const { rows: leadRows } = await query<LeadRow>("select * from leads where id = $1", [id]);
      const lead = leadRows[0];
      if (lead) {
        await query("insert into lead_entries (lead_id, channel, happened_at, service, note) values ($1,$2,$3,$4,$5)", [
          id,
          lead.channel,
          new Date(lead.created_at).toLocaleString(),
          [lead.doctor, lead.department].filter(Boolean).join(" "),
          lead.note,
        ]);
      }
    }
    if (entry) {
      await query("insert into lead_entries (lead_id, channel, happened_at, service, note) values ($1,$2,'just now',$3,$4)", [
        id,
        entry.channel,
        entry.service,
        entry.note,
      ]);
    }

    const { rows } = await query<LeadRow>("update leads set merged = true where id = $1 returning *", [id]);
    res.status(200).json(await serializeLead(rows[0]));
  },
});
