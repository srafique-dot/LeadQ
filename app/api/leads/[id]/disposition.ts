import { query } from "../../_db";
import { route, body } from "../../_http";
import { serializeLead, type LeadRow } from "../../_leads";

const TERMINAL = new Set(["appointment_purchased", "appointment_booked", "ni_price", "ni_distance", "ni_elsewhere", "wrong_person", "duplicate"]);
const WIN = new Set(["appointment_purchased", "appointment_booked"]);
const FAILED = new Set(["not_responding", "busy", "number_off", "call_rejected"]);
const MAX_ATTEMPTS = 4;

interface DispositionBody {
  l1: string;
  l2: string | null;
  note: string;
  nextActionDate: string;
  erpRefType: "" | "booking" | "invoice";
  erpRefValue: string;
  agentId: string;
  agentName: string;
}

export default route({
  POST: async (req, res) => {
    const id = String(req.query.id);
    const b = body<DispositionBody>(req);

    const { rows: leadRows } = await query<LeadRow>("select * from leads where id = $1", [id]);
    const lead = leadRows[0];
    if (!lead) return void res.status(404).json({ error: "not_found" });

    await query(
      "insert into dispositions (lead_id, attempt, agent_id, agent_name, l1, l2, note) values ($1,$2,$3,$4,$5,$6,$7)",
      [id, lead.attempt, b.agentId, b.agentName, b.l1, b.l2, b.note.trim()],
    );

    const isTerminal = !!b.l2 && TERMINAL.has(b.l2);
    const isFailed = FAILED.has(b.l1);
    const isCallback = b.l2 === "callback_later";

    let status = lead.status;
    let attempt = lead.attempt;
    let detail = lead.detail;
    let nextActionDate: string | null = null;

    if (isTerminal) {
      status = b.l2 && WIN.has(b.l2) ? "booked" : "closed";
      detail = `${b.l2} · ${new Date().toLocaleString()}`;
    } else if (isFailed) {
      if (lead.attempt >= MAX_ATTEMPTS) {
        status = "closed";
        detail = "Exhausted after 4 attempts · " + new Date().toLocaleString();
      } else {
        attempt = lead.attempt + 1;
        status = "trying";
        const back = new Date(Date.now() + 12 * 60000);
        detail = `Call ${attempt} of 4 · back around ${back.getHours()}:${String(back.getMinutes()).padStart(2, "0")}`;
      }
    } else if (isCallback) {
      status = "trying";
      nextActionDate = b.nextActionDate;
      detail = "Callback scheduled · " + b.nextActionDate;
    } else {
      status = "trying";
      detail = (b.l2 ?? "Open") + " · " + new Date().toLocaleString();
    }

    const { rows } = await query<LeadRow>(
      `update leads set status = $1, attempt = $2, detail = $3, next_action_date = $4,
         erp_ref_type = case when $5 <> '' then $5 else erp_ref_type end,
         erp_ref_value = case when $6 <> '' then $6 else erp_ref_value end
       where id = $7 returning *`,
      [status, attempt, detail, nextActionDate, b.erpRefType, b.erpRefValue, id],
    );
    res.status(200).json(await serializeLead(rows[0]));
  },
});
