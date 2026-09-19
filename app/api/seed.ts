import bcrypt from "bcryptjs";
import { query } from "./_db.js";
import { route } from "./_http.js";

/**
 * One-time setup endpoint: seeds the mock accounts from the design handoff
 * so the deployed app has real logins on day one. Safe to call more than
 * once — accounts are ON CONFLICT DO NOTHING, so it never overwrites a
 * password someone has already changed.
 *
 * Visit /api/seed?key=YOUR_SEED_SECRET once after running db/schema.sql.
 * Set SEED_SECRET in the Vercel project's environment variables first.
 */
const ACCOUNTS = [
  { id: "NUSRAT_002", name: "Nusrat Jahan", role: "agent", password: "queue123", ext: "2102", facility: "UMCH Main" },
  { id: "FARHANA_009", name: "Farhana Islam", role: "agent", password: "Kf7-r2mq", ext: "", facility: "Medix Uttara" },
  { id: "ISHRAT_007", name: "Ishrat Sultana", role: "requester", password: "queue123", ext: "", facility: "Medix Uttara" },
  { id: "SHAHRIAR_001", name: "Shahriar Kabir", role: "admin", password: "queue123", ext: "2001", facility: "All sites" },
  { id: "SABBIR_001", name: "Sabbir Chowdhury", role: "superadmin", password: "queue123", ext: "", facility: "All sites" },
];

export default route({
  GET: async (req, res) => {
    if (!process.env.SEED_SECRET || req.query.key !== process.env.SEED_SECRET) {
      return void res.status(403).json({ error: "Set SEED_SECRET in the Vercel project and pass ?key=that value." });
    }
    for (const a of ACCOUNTS) {
      const hash = await bcrypt.hash(a.password, 10);
      await query(
        `insert into accounts (employee_id, name, role, password_hash, must_change_password, calling_number, facility)
         values ($1,$2,$3,$4,$5,$6,$7)
         on conflict (employee_id) do nothing`,
        [a.id, a.name, a.role, hash, a.password === "Kf7-r2mq", a.ext, a.facility],
      );
    }
    res.status(200).json({ ok: true, seeded: ACCOUNTS.map((a) => a.id) });
  },
});
