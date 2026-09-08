import { query } from "../_db";
import { route } from "../_http";

const TARGET_MIN = 5;

export default route({
  GET: async (_req, res) => {
    const [waiting, dayStats, pastTarget, overdueCallbacks, escalated] = await Promise.all([
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
    });
  },
});
