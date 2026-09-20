import { query } from "../_db.js";
import { route, body } from "../_http.js";

interface ChannelRow {
  name: string;
  active: boolean;
  created_by: string;
  created_at: string;
}

function serialize(c: ChannelRow) {
  return { name: c.name, active: c.active, createdBy: c.created_by, createdAt: c.created_at };
}

interface NewChannelBody {
  name: string;
  createdBy: string;
}
interface ToggleBody {
  name: string;
  active: boolean;
}

/** Superadmin-managed "how did this lead come in" list. GET/create/toggle
 * share one function (Vercel Hobby caps a deployment at 12). */
export default route({
  GET: async (_req, res) => {
    const { rows } = await query<ChannelRow>("select * from channels order by created_at asc");
    res.status(200).json(rows.map(serialize));
  },

  POST: async (req, res) => {
    if (req.query.action === "toggle") {
      const { name, active } = body<ToggleBody>(req);
      const { rows } = await query<ChannelRow>("update channels set active = $1 where name = $2 returning *", [active, name]);
      return void res.status(200).json(serialize(rows[0]));
    }

    const { name, createdBy } = body<NewChannelBody>(req);
    const { rows } = await query<ChannelRow>(
      "insert into channels (name, created_by) values ($1,$2) returning *",
      [name.trim(), createdBy],
    );
    res.status(201).json(serialize(rows[0]));
  },
});
