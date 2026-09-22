import { query } from "./_db.js";
import type { LeadRow } from "./_leads.js";

/** How long an agent's "I'm on this call" claim survives without a logged
 * outcome. Past this the lead is claimable again, so someone stepping away
 * mid-call can't strand it. Deliberately longer than ABANDONED_AFTER_MIN so
 * a supervisor sees the stall before it silently resolves itself. */
export const CLAIM_TTL_MIN = 15;

/** When the floor view starts flagging a claim as abandoned. */
export const ABANDONED_AFTER_MIN = 10;

/** Leads handed to one agent at a time. Small on purpose: enough to work
 * through without breaks in flow, few enough that an agent going home
 * doesn't take a big slice of the queue cold with them. */
export const WORKING_SET = 8;

/** How long a lead stays glued to the agent who last spoke to the caller.
 * Matches the "same agent for follow-ups within the week" rule. */
export const STICKY_DAYS = 7;

const OPEN = "status in ('waiting','trying') and not escalated";
const DUE = "(next_action_date is null or next_action_date <= current_date)";

/** Hands leads back to the pool when holding them no longer helps anyone:
 * either the agent never actually spoke to them and has since gone
 * unavailable, or the sticky window has run out since their last call.
 * Leads under an active claim are left alone — someone is on the phone. */
export async function releaseStaleAssignments(): Promise<void> {
  await query(
    `update leads l
        set assigned_to = null, assigned_at = null
      where l.assigned_to is not null
        and l.claimed_by is null
        and ${OPEN}
        and (
          -- never worked by this agent, and they are not at their desk
          (not exists (
             select 1 from dispositions d
              where d.lead_id = l.id and d.agent_id = l.assigned_to
           )
           and exists (
             select 1 from accounts a
              where a.employee_id = l.assigned_to and a.presence <> 'available'
           ))
          -- or the sticky window since their last call has expired
          or (select max(d.created_at) from dispositions d
                where d.lead_id = l.id and d.agent_id = l.assigned_to)
             < now() - ($1 || ' days')::interval
        )`,
    [STICKY_DAYS],
  );
}

/** Tops an agent's working set back up from the unassigned pool.
 *
 * FOR UPDATE SKIP LOCKED is what makes this safe under concurrency: two
 * agents topping up at the same instant each lock a disjoint set of rows
 * and the second simply skips past the first's, so the same lead is never
 * handed to both. Urgent first, then oldest first — the same order the
 * queue has always used. */
export async function topUpWorkingSet(agentId: string): Promise<void> {
  const { rows } = await query<{ count: string }>(
    `select count(*)::text as count from leads
      where assigned_to = $1 and ${OPEN} and ${DUE}`,
    [agentId],
  );
  const shortfall = WORKING_SET - Number(rows[0]?.count ?? 0);
  if (shortfall <= 0) return;

  await query(
    `update leads
        set assigned_to = $1, assigned_at = now()
      where id in (
        select id from leads
         where ${OPEN} and ${DUE} and assigned_to is null and claimed_by is null
         order by urgent desc, created_at asc
         limit $2
         for update skip locked
      )`,
    [agentId, shortfall],
  );
}

/** Work an agent may pick up that isn't theirs: leads whose owner is away
 * and which can't wait — a callback already past its date, or a first call
 * still unmade. Borrowing is a loan, not a transfer; saveDisposition hands
 * the lead back to its owner afterwards. */
export function borrowableSql(): string {
  return `
    select l.* from leads l
     where ${OPEN} and ${DUE}
       and l.claimed_by is null
       and l.assigned_to is not null
       and l.assigned_to <> $1
       and exists (
         select 1 from accounts a
          where a.employee_id = l.assigned_to and a.presence <> 'available'
       )
       and (
         (l.next_action_date is not null and l.next_action_date <= current_date)
         or not exists (select 1 from dispositions d where d.lead_id = l.id)
       )
     order by l.urgent desc, l.created_at asc
     limit 20`;
}

export function assignedSql(): string {
  return `
    select l.* from leads l
     where ${OPEN} and ${DUE} and l.assigned_to = $1
     order by l.urgent desc, l.created_at asc`;
}

/** The atomic claim. The WHERE clause is the whole point: Postgres
 * serializes concurrent UPDATEs on the same row, and the loser re-checks
 * this predicate against the winner's committed row and matches nothing.
 * Returns null when someone else holds a live claim. */
export async function claimLead(leadId: string, agentId: string): Promise<LeadRow | null> {
  const { rows } = await query<LeadRow>(
    `update leads
        set claimed_by = $1, claimed_at = now()
      where id = $2
        and (claimed_by is null
             or claimed_by = $1
             or claimed_at < now() - ($3 || ' minutes')::interval)
      returning *`,
    [agentId, leadId, CLAIM_TTL_MIN],
  );
  return rows[0] ?? null;
}

/** Who is holding a lead, for the "someone else is on this" message. */
export async function claimHolder(leadId: string): Promise<{ id: string; name: string } | null> {
  const { rows } = await query<{ employee_id: string; name: string }>(
    `select a.employee_id, a.name from leads l
       join accounts a on a.employee_id = l.claimed_by
      where l.id = $1`,
    [leadId],
  );
  return rows[0] ? { id: rows[0].employee_id, name: rows[0].name } : null;
}
