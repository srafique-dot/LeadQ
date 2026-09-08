import { query } from "../../_db";
import { route } from "../../_http";
import { serializeLead, type LeadRow } from "../../_leads";

export default route({
  POST: async (req, res) => {
    const id = String(req.query.id);
    const { rows } = await query<LeadRow>("update leads set merged = false where id = $1 returning *", [id]);
    res.status(200).json(await serializeLead(rows[0]));
  },
});
