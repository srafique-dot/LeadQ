import { query } from "../_db.js";
import { route, body } from "../_http.js";

interface ChannelRow {
  name: string;
  active: boolean;
  created_by: string | null;
  created_at: string;
}

function serialize(c: ChannelRow) {
  return { name: c.name, active: c.active, createdBy: c.created_by ?? "", createdAt: c.created_at };
}

interface NewChannelBody {
  name: string;
  createdBy: string;
}
interface ToggleBody {
  name: string;
  active: boolean;
}
interface SetSettingBody {
  key: string;
  value: string;
  updatedBy: string;
}

/** Superadmin-managed "how did this lead come in" list, plus the generic
 * settings key/value store — unrelated concerns sharing one function only
 * because Vercel Hobby caps a deployment at 12 serverless functions and this
 * one was already the closest fit (small superadmin-editable config). GET
 * dispatches on ?resource=, POST on ?action=. */
export default route({
  GET: async (req, res) => {
    if (req.query.resource === "settings") {
      const { rows } = await query<{ key: string; value: string }>("select key, value from settings");
      return void res.status(200).json(Object.fromEntries(rows.map((r) => [r.key, r.value])));
    }

    const { rows } = await query<ChannelRow>("select * from channels order by created_at asc");
    res.status(200).json(rows.map(serialize));
  },

  POST: async (req, res) => {
    if (req.query.action === "toggle") {
      const { name, active } = body<ToggleBody>(req);
      const { rows } = await query<ChannelRow>("update channels set active = $1 where name = $2 returning *", [active, name]);
      return void res.status(200).json(serialize(rows[0]));
    }

    if (req.query.action === "set-setting") {
      const { key, value, updatedBy } = body<SetSettingBody>(req);
      const { rows } = await query<{ key: string; value: string }>(
        "update settings set value = $1, updated_by = $2, updated_at = now() where key = $3 returning key, value",
        [value, updatedBy, key],
      );
      if (!rows[0]) return void res.status(404).json({ error: "unknown_setting" });
      return void res.status(200).json(rows[0]);
    }

    const { name, createdBy } = body<NewChannelBody>(req);
    const { rows } = await query<ChannelRow>(
      "insert into channels (name, created_by) values ($1,$2) returning *",
      [name.trim(), createdBy],
    );
    res.status(201).json(serialize(rows[0]));
  },
});
