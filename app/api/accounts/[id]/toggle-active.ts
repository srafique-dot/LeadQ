import { query } from "../../_db";
import { route, body } from "../../_http";

export default route({
  POST: async (req, res) => {
    const id = String(req.query.id).toUpperCase();
    const { active } = body<{ active: boolean }>(req);
    const { rowCount } = await query("update accounts set active = $1 where employee_id = $2", [active, id]);
    if (!rowCount) return void res.status(404).json({ error: "not_found" });
    res.status(200).json({ ok: true });
  },
});
