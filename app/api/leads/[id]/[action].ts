import { query } from "../../_db.js";
import { route, body } from "../../_http.js";
import { serializeLead, type LeadRow } from "../../_leads.js";

const TERMINAL = new Set(["appointment_purchased", "appointment_booked", "ni_price", "ni_distance", "ni_elsewhere", "wrong_person", "duplicate"]);
const WIN = new Set(["appointment_purchased", "appointment_booked"]);
const FAILED = new Set(["not_responding", "busy", "number_off", "call_rejected"]);
const MAX_ATTEMPTS = 4;

/** Human labels for l2 codes, mirrored from src/api/leads.ts's LEVEL2 —
 * `detail` is shown to Requesters, so it can't carry the raw enum value. */
const L2_LABELS: Record<string, string> = {
  appointment_purchased: "Appointment booked + paid",
  appointment_booked: "Appointment booked, not paid",
  info_given: "Will decide later",
  callback_later: "Call them back later",
  ni_price: "Not interested — price",
  ni_distance: "Not interested — too far",
  ni_elsewhere: "Not interested — went elsewhere",
  wrong_person: "Wrong person",
  duplicate: "Same lead twice",
};

interface MergeBody {
  entry?: { channel: string; service: string; note: string };
}
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
interface EscalateBody {
  agentId: string;
  agentName: string;
}

/** All single-lead actions (merge, disposition, escalate, unescalate, split)
 * share one function — Vercel Hobby caps a deployment at 12 serverless
 * functions — dispatching on the [action] path segment. */
export default route({
  POST: async (req, res) => {
    const id = String(req.query.id);
    const action = String(req.query.action);

    switch (action) {
      case "merge": {
        const { entry } = body<MergeBody>(req);
        const { rows: existingEntries } = await query<{ count: string }>("select count(*)::text from lead_entries where lead_id = $1", [id]);
        if (Number(existingEntries[0].count) === 0) {
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
        return void res.status(200).json(await serializeLead(rows[0]));
      }

      case "disposition": {
        const b = body<DispositionBody>(req);
        const { rows: leadRows } = await query<LeadRow>("select * from leads where id = $1", [id]);
        const lead = leadRows[0];
        if (!lead) return void res.status(404).json({ error: "not_found" });

        await query("insert into dispositions (lead_id, attempt, agent_id, agent_name, l1, l2, note) values ($1,$2,$3,$4,$5,$6,$7)", [
          id,
          lead.attempt,
          b.agentId,
          b.agentName,
          b.l1,
          b.l2,
          b.note.trim(),
        ]);

        const isTerminal = !!b.l2 && TERMINAL.has(b.l2);
        const isFailed = FAILED.has(b.l1);
        const isCallback = b.l2 === "callback_later";

        let status = lead.status;
        let attempt = lead.attempt;
        let detail = lead.detail;
        let nextActionDate: string | null = null;

        if (isTerminal) {
          status = b.l2 && WIN.has(b.l2) ? "booked" : "closed";
          detail = `${b.l2 ? L2_LABELS[b.l2] ?? b.l2 : ""} · ${new Date().toLocaleString()}`;
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
          detail = (b.l2 ? L2_LABELS[b.l2] ?? b.l2 : "Open") + " · " + new Date().toLocaleString();
        }

        const { rows } = await query<LeadRow>(
          `update leads set status = $1, attempt = $2, detail = $3, next_action_date = $4,
             erp_ref_type = case when $5 <> '' then $5 else erp_ref_type end,
             erp_ref_value = case when $6 <> '' then $6 else erp_ref_value end
           where id = $7 returning *`,
          [status, attempt, detail, nextActionDate, b.erpRefType, b.erpRefValue, id],
        );
        return void res.status(200).json(await serializeLead(rows[0]));
      }

      case "escalate": {
        const { agentId, agentName } = body<EscalateBody>(req);
        const { rows } = await query<LeadRow>(
          "update leads set escalated = true, escalated_by = $1, escalated_at = now() where id = $2 returning *",
          [`${agentId} ${agentName}`, id],
        );
        return void res.status(200).json(await serializeLead(rows[0]));
      }

      case "unescalate": {
        const { rows } = await query<LeadRow>(
          "update leads set escalated = false, escalated_by = '', escalated_at = null where id = $1 returning *",
          [id],
        );
        return void res.status(200).json(await serializeLead(rows[0]));
      }

      case "split": {
        const { rows } = await query<LeadRow>("update leads set merged = false where id = $1 returning *", [id]);
        return void res.status(200).json(await serializeLead(rows[0]));
      }

      default:
        res.status(404).json({ error: "unknown_action" });
    }
  },
});
