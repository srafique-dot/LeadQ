import { query } from "../_db";
import { route } from "../_http";
import { serializeLead, digitsOf, type LeadRow } from "../_leads";

export default route({
  GET: async (req, res) => {
    const phone = String(req.query.phone ?? "");
    const digits = digitsOf(phone);
    if (digits.length < 7) return void res.status(200).json(null);
    const { rows } = await query<LeadRow>("select * from leads where digits = $1 limit 1", [digits]);
    res.status(200).json(rows[0] ? await serializeLead(rows[0]) : null);
  },
});
