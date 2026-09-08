import bcrypt from "bcryptjs";
import { query } from "../../_db";
import { route } from "../../_http";
import { generatePassword } from "../../_passwords";

export default route({
  POST: async (req, res) => {
    const id = String(req.query.id).toUpperCase();
    const password = generatePassword();
    const hash = await bcrypt.hash(password, 10);
    const { rowCount } = await query("update accounts set password_hash = $1, must_change_password = true where employee_id = $2", [hash, id]);
    if (!rowCount) return void res.status(404).json({ error: "not_found" });
    res.status(200).json({ password });
  },
});
