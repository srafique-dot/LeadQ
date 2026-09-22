import { query } from "../_db.js";
import { route } from "../_http.js";
import { ABANDONED_AFTER_MIN } from "../_routing.js";

const TARGET_MIN = 5;

export default route({
  GET: async (_req, res) => {
    const [waiting, dayStats, pastTarget, overdueCallbacks, escalated, abandoned, roster] = await Promise.all([
      query<{ count: string; oldest_min: number | null }>(
        "select count(*)::text as count, extract(epoch from (now() - min(created_at)))/60 as oldest_min from leads where status = 'waiting'",
      ),
      query<{ agent_id: string; agent_name: string; worked: string; outcomes: string; booked: string; no_answer: string }>(`
        select agent_id, max(agent_name) as agent_name,
               count(distinct lead_id)::text as worked,
               count(*)::text as outcomes,
               count(*) filter (where l2 in ('appointment_booked','appointment_purchased'))::text as booked,
               count(*) filter (where l1 in ('not_responding','busy','number_off','call_rejected'))::text as no_answer
        from dispositions
        where created_at::date = current_date
        group by agent_id
      `),
      query<{ id: string; name: string; facility: string; urgent: boolean; created_at: string }>(
        `select l.id, l.name, l.facility, l.urgent, l.created_at from leads l
         where l.status = 'waiting' and l.created_at < now() - ($1 || ' minutes')::interval
           and not exists (select 1 from dispositions d where d.lead_id = l.id)`,
        [TARGET_MIN],
      ),
      query<{ id: string; name: string; facility: string; next_action_date: string }>(
        "select id, name, facility, next_action_date from leads where next_action_date is not null and next_action_date < current_date and status in ('waiting','trying')",
      ),
      query<{ id: string; name: string; escalated_by: string; escalated_at: string }>(
        "select id, name, escalated_by, escalated_at from leads where escalated = true order by escalated_at desc",
      ),
      // Claimed, but no outcome logged since — someone opened the lead and
      // walked away from it. Surfaced before the claim self-expires so a
      // supervisor can step in rather than just waiting it out.
      query<{ id: string; name: string; claimed_by: string; claimed_by_name: string | null; held_min: number }>(
        `select l.id, l.name, l.claimed_by, a.name as claimed_by_name,
                extract(epoch from (now() - l.claimed_at))/60 as held_min
           from leads l
           left join accounts a on a.employee_id = l.claimed_by
          where l.claimed_by is not null
            and l.claimed_at < now() - ($1 || ' minutes')::interval
          order by l.claimed_at asc`,
        [ABANDONED_AFTER_MIN],
      ),
      // Who is on the floor, and how much work is sitting with each of them.
      query<{ employee_id: string; name: string; presence: string; assigned: string; on_call: string | null }>(
        `select a.employee_id, a.name, a.presence,
                count(l.id) filter (where l.status in ('waiting','trying'))::text as assigned,
                max(c.name) as on_call
           from accounts a
           left join leads l on l.assigned_to = a.employee_id
           left join leads c on c.claimed_by = a.employee_id
          where a.role = 'agent' and a.active
          group by a.employee_id, a.name, a.presence
          order by a.name`,
      ),
    ]);

    const workedToday = dayStats.rows.reduce((n, r) => n + Number(r.worked), 0);
    const outcomesToday = dayStats.rows.reduce((n, r) => n + Number(r.outcomes), 0);
    const bookedToday = dayStats.rows.reduce((n, r) => n + Number(r.booked), 0);

    res.status(200).json({
      queue: {
        waiting: Number(waiting.rows[0]?.count ?? 0),
        oldestWaitMin: Math.floor(waiting.rows[0]?.oldest_min ?? 0),
        workedToday,
        outcomesToday,
        bookedToday,
      },
      dayStatsByAgent: dayStats.rows.map((r) => ({
        agentId: r.agent_id,
        agentName: r.agent_name,
        worked: Number(r.worked),
        outcomes: Number(r.outcomes),
        booked: Number(r.booked),
        noAnswer: Number(r.no_answer),
      })),
      pastTarget: pastTarget.rows,
      overdueCallbacks: overdueCallbacks.rows,
      escalated: escalated.rows,
      abandoned: abandoned.rows.map((r) => ({
        id: r.id,
        name: r.name,
        claimedBy: r.claimed_by,
        claimedByName: r.claimed_by_name ?? r.claimed_by,
        heldMin: Math.floor(r.held_min),
      })),
      roster: roster.rows.map((r) => ({
        agentId: r.employee_id,
        agentName: r.name,
        presence: r.presence,
        assigned: Number(r.assigned),
        onCall: r.on_call ?? "",
      })),
    });
  },
});
