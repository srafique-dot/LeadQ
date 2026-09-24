import { pool, query } from "../../_db.js";
import { route, body } from "../../_http.js";
import { serializeLead, dhaka, type LeadRow } from "../../_leads.js";
import { claimLead, claimHolder, RETRY_AFTER_MIN } from "../../_routing.js";
import { allow } from "../../_auth.js";

const LEVEL1 = new Set(["connected", "not_responding", "busy", "number_off", "invalid_number", "call_rejected", "international"]);
const LEVEL2 = new Set([
  "appointment_purchased", "appointment_booked", "info_given", "callback_later",
  "ni_price", "ni_distance", "ni_elsewhere", "wrong_person", "duplicate", "already_handled",
]);
const TERMINAL = new Set(["appointment_purchased", "appointment_booked", "ni_price", "ni_distance", "ni_elsewhere", "wrong_person", "duplicate", "already_handled"]);
const WIN = new Set(["appointment_purchased", "appointment_booked"]);
const FAILED = new Set(["not_responding", "busy", "number_off", "call_rejected"]);
const MAX_ATTEMPTS = 4;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

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
  already_handled: "Already has an appointment / already a patient",
};

/** No outbound line can dial these — the fixed reason a disposition of
 * "international" writes when it auto-escalates (see the disposition
 * case below), shown to the team lead exactly like a manual escalation. */
const INTERNATIONAL_ESCALATION_REASON = "International number — agents can't dial this. Needs a follow-up by email.";


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
}
interface EscalateBody {
  reason: string;
}
interface ReassignBody {
  agentId: string | null;
}

/** All single-lead actions share one function — Vercel Hobby caps a
 * deployment at 12 serverless functions — dispatching on [action]. Who did
 * something is always the session, never a field in the request. */
export default route({
  POST: async (req, res, session) => {
    const id = String(req.query.id);
    const action = String(req.query.action);
    const me = session.employeeId;

    switch (action) {
      case "claim": {
        if (!allow(res, session, "agent", "admin", "superadmin")) return;
        const claimed = await claimLead(id, me);
        if (!claimed) {
          const holder = await claimHolder(id);
          return void res.status(409).json({ error: "already_claimed", holderName: holder?.name ?? "another agent" });
        }
        return void res.status(200).json(await serializeLead(claimed));
      }

      case "release": {
        // Scoped to the caller so a late release can't knock someone else off.
        const { rows } = await query<LeadRow>(
          "update leads set claimed_by = null, claimed_at = null where id = $1 and claimed_by = $2 returning *",
          [id, me],
        );
        if (rows[0]) return void res.status(200).json(await serializeLead(rows[0]));
        const { rows: current } = await query<LeadRow>("select * from leads where id = $1", [id]);
        if (!current[0]) return void res.status(404).json({ error: "not_found" });
        return void res.status(200).json(await serializeLead(current[0]));
      }

      case "reassign": {
        if (!allow(res, session, "admin", "superadmin")) return;
        const { agentId } = body<ReassignBody>(req);
        if (agentId) {
          const { rows: target } = await query("select 1 from accounts where employee_id = $1 and role = 'agent' and active", [agentId]);
          if (!target[0]) return void res.status(400).json({ error: "not_an_active_agent" });
        }
        // Also drops any claim, so a lead stuck behind someone who walked
        // away can be moved without waiting it out.
        const { rows } = await query<LeadRow>(
          `update leads
              set assigned_to = $1,
                  assigned_at = case when $1::text is null then null else now() end,
                  claimed_by = null,
                  claimed_at = null
            where id = $2
            returning *`,
          [agentId || null, id],
        );
        if (!rows[0]) return void res.status(404).json({ error: "not_found" });
        return void res.status(200).json(await serializeLead(rows[0]));
      }

      case "merge": {
        const { entry } = body<MergeBody>(req);
        const { rows: leadRows } = await query<LeadRow>("select * from leads where id = $1", [id]);
        const lead = leadRows[0];
        if (!lead) return void res.status(404).json({ error: "not_found" });
        const { rows: existingEntries } = await query<{ count: string }>("select count(*)::text from lead_entries where lead_id = $1", [id]);
        if (Number(existingEntries[0].count) === 0) {
          await query("insert into lead_entries (lead_id, channel, happened_at, service, note) values ($1,$2,$3,$4,$5)", [
            id,
            lead.channel,
            dhaka(new Date(lead.created_at)),
            [lead.doctor, lead.department].filter(Boolean).join(" "),
            lead.note,
          ]);
        }
        if (entry) {
          await query("insert into lead_entries (lead_id, channel, happened_at, service, note) values ($1,$2,$3,$4,$5)", [
            id,
            entry.channel ?? "",
            dhaka(new Date()),
            entry.service ?? "",
            entry.note ?? "",
          ]);
        }
        const { rows } = await query<LeadRow>("update leads set merged = true where id = $1 returning *", [id]);
        return void res.status(200).json(await serializeLead(rows[0]));
      }

      case "disposition": {
        if (!allow(res, session, "agent", "admin", "superadmin")) return;
        const b = body<DispositionBody>(req);
        if (!LEVEL1.has(b.l1)) return void res.status(400).json({ error: "bad_outcome" });
        if (b.l2 !== null && b.l2 !== undefined && !LEVEL2.has(b.l2)) return void res.status(400).json({ error: "bad_outcome" });
        if (b.l1 === "connected" && !b.l2) return void res.status(400).json({ error: "bad_outcome" });
        if (b.l2 === "callback_later" && !ISO_DATE.test(b.nextActionDate ?? "")) {
          return void res.status(400).json({ error: "bad_callback_date" });
        }

        const client = await pool.connect();
        try {
          await client.query("begin");
          // Row lock: two saves of the same lead (a double-click, or two
          // people) are serialized here instead of both being logged.
          const { rows: leadRows } = await client.query<LeadRow>("select * from leads where id = $1 for update", [id]);
          const lead = leadRows[0];
          if (!lead) {
            await client.query("rollback");
            return void res.status(404).json({ error: "not_found" });
          }
          if (lead.status === "booked" || lead.status === "closed") {
            await client.query("rollback");
            return void res.status(409).json({ error: "already_closed" });
          }
          // You log an outcome on the call you're on. If the claim is gone
          // (a supervisor moved the lead, or this is the second click of a
          // save that already went through) or someone else took it over
          // after yours expired, refuse rather than record it twice or over
          // the top of them. A stale claim that's still yours is fine —
          // nobody else picked it up.
          if (lead.claimed_by !== me) {
            await client.query("rollback");
            return void res.status(409).json({ error: "not_your_claim" });
          }

          await client.query(
            "insert into dispositions (lead_id, attempt, agent_id, agent_name, l1, l2, note) values ($1,$2,$3,$4,$5,$6,$7)",
            [id, lead.attempt, me, session.name, b.l1, b.l2 ?? null, (b.note ?? "").trim()],
          );

          const now = new Date();
          let status = lead.status;
          let attempt = lead.attempt;
          let detail = lead.detail;
          let nextActionDate: string | null = null;
          let retryAfter: Date | null = null;

          if (b.l2 && TERMINAL.has(b.l2)) {
            status = WIN.has(b.l2) ? "booked" : "closed";
            detail = `${L2_LABELS[b.l2] ?? b.l2} · ${dhaka(now)}`;
          } else if (FAILED.has(b.l1)) {
            if (lead.attempt >= MAX_ATTEMPTS) {
              status = "closed";
              detail = `Exhausted after ${MAX_ATTEMPTS} attempts · ${dhaka(now)}`;
            } else {
              attempt = lead.attempt + 1;
              status = "trying";
              // Held out of the queue until then — otherwise it's still the
              // oldest lead and comes straight back to the top.
              retryAfter = new Date(now.getTime() + RETRY_AFTER_MIN * 60000);
              detail = `Call ${attempt} of ${MAX_ATTEMPTS} · back around ${dhaka(retryAfter, false)}`;
            }
          } else if (b.l1 === "invalid_number") {
            status = "closed";
            detail = `Wrong number · ${dhaka(now)}`;
          } else if (b.l1 === "international") {
            // Never actually dialled — status is left as it was. Escalating
            // is what pulls it out of every agent queue (both queue queries
            // filter "not escalated" regardless of status), so a supervisor
            // sees it and follows up by email instead of an agent getting it
            // back and being stuck the same way.
            detail = `International number — routed to your supervisor · ${dhaka(now)}`;
          } else if (b.l2 === "callback_later") {
            status = "trying";
            nextActionDate = b.nextActionDate;
            detail = `Callback scheduled · ${b.nextActionDate}`;
          } else {
            status = "trying";
            detail = `${b.l2 ? L2_LABELS[b.l2] ?? b.l2 : "Open"} · ${dhaka(now)}`;
          }

          // The lead sticks to whoever just spoke to the caller — unless this
          // was a loan (covering for the assigned agent), in which case it
          // goes home to its owner rather than being quietly taken over.
          const wasLoan = !!lead.assigned_to && lead.assigned_to !== me;
          const nextAssignee = wasLoan ? lead.assigned_to : me;
          const autoEscalate = b.l1 === "international";

          const { rows } = await client.query<LeadRow>(
            `update leads set status = $1, attempt = $2, detail = $3, next_action_date = $4,
               erp_ref_type = case when $5 <> '' then $5 else erp_ref_type end,
               erp_ref_value = case when $6 <> '' then $6 else erp_ref_value end,
               assigned_to = $8, assigned_at = now(),
               claimed_by = null, claimed_at = null,
               retry_after = $9,
               escalated = case when $10 then true else escalated end,
               escalated_by = case when $10 then $11 else escalated_by end,
               escalated_at = case when $10 then now() else escalated_at end,
               escalated_reason = case when $10 then $12 else escalated_reason end
             where id = $7 returning *`,
            [
              status,
              attempt,
              detail,
              nextActionDate,
              ["booking", "invoice"].includes(b.erpRefType) ? b.erpRefType : "",
              (b.erpRefValue ?? "").trim(),
              id,
              nextAssignee,
              retryAfter,
              autoEscalate,
              `${me} ${session.name}`,
              INTERNATIONAL_ESCALATION_REASON,
            ],
          );
          await client.query("commit");
          return void res.status(200).json(await serializeLead(rows[0]));
        } catch (err) {
          await client.query("rollback").catch(() => undefined);
          throw err;
        } finally {
          client.release();
        }
      }

      case "escalate": {
        if (!allow(res, session, "agent", "admin", "superadmin")) return;
        const reason = (body<EscalateBody>(req).reason ?? "").trim();
        if (!reason) return void res.status(400).json({ error: "missing_reason" });
        // Keeps assigned_to so the lead goes back to the same agent when the
        // supervisor returns it; the claim clears because they've let go of it.
        const { rows } = await query<LeadRow>(
          `update leads set escalated = true, escalated_by = $1, escalated_at = now(), escalated_reason = $2,
                  claimed_by = null, claimed_at = null
            where id = $3 returning *`,
          [`${me} ${session.name}`, reason.slice(0, 500), id],
        );
        if (!rows[0]) return void res.status(404).json({ error: "not_found" });
        return void res.status(200).json(await serializeLead(rows[0]));
      }

      case "unescalate": {
        if (!allow(res, session, "admin", "superadmin")) return;
        // Default: back to the queue, same as always. resolution "closed" is
        // for an escalation handled outside the calling queue entirely (an
        // emailed international patient, a complaint settled by phone) —
        // sending it back to an agent who can't do anything more with it
        // would just land it right back here.
        const { resolution } = body<{ resolution?: "closed" }>(req);
        const closeIt = resolution === "closed";
        const { rows } = await query<LeadRow>(
          `update leads set escalated = false, escalated_by = '', escalated_at = null, escalated_reason = '',
                  status = case when $2 then 'closed'::lead_status else status end,
                  detail = case when $2 then $3 else detail end
            where id = $1 returning *`,
          [id, closeIt, `Handled outside the calling queue · ${dhaka(new Date())}`],
        );
        if (!rows[0]) return void res.status(404).json({ error: "not_found" });
        return void res.status(200).json(await serializeLead(rows[0]));
      }

      case "split": {
        if (!allow(res, session, "agent", "admin", "superadmin")) return;
        const { rows } = await query<LeadRow>("update leads set merged = false where id = $1 returning *", [id]);
        if (!rows[0]) return void res.status(404).json({ error: "not_found" });
        return void res.status(200).json(await serializeLead(rows[0]));
      }

      default:
        res.status(404).json({ error: "unknown_action" });
    }
  },
});
