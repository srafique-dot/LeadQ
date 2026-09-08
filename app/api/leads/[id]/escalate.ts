import { query } from "../../_db";
import { route, body } from "../../_http";
import { serializeLead, type LeadRow } from "../../_leads";

interface EscalateBody {
  agentId: string;
  agentName: string;
}

export default route({
  POST: async (req, res) => {
    const id = String(req.query.id);
    const { agentId, agentName } = body<EscalateBody>(req);
    const { rows } = await query<LeadRow>(
      "update leads set escalated = true, escalated_by = $1, escalated_at = now() where id = $2 returning *",
      [`${agentId} ${agentName}`, id],
    );
    res.status(200).json(await serializeLead(rows[0]));
  },
});
