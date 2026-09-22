import { query } from "../_db.js";
import { route } from "../_http.js";
import { serializeAccount, type AccountRow } from "../_accounts.js";

export default route({
  GET: async (_req, res) => {
    const { rows } = await query<AccountRow>("select employee_id, name, email, role, must_change_password, calling_number, active, facility, presence from accounts order by created_at desc");
    res.status(200).json(rows.map(serializeAccount));
  },
});
