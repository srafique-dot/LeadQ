import { query } from "../_db.js";
import { route } from "../_http.js";

export default route({
  GET: async (req, res) => {
    const name = String(req.query.name);
    const { rows } = await query<{ instructions: string }>("select instructions from cohorts where name = $1", [name]);
    res.status(200).json({ instructions: rows[0]?.instructions ?? "" });
  },
});
