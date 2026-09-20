import { query } from "../_db.js";
import { route, body } from "../_http.js";

const ROLE_LABEL: Record<string, string> = {
  requester: "Business development",
  agent: "Call centre agent",
  admin: "Team lead",
  superadmin: "Superadmin",
};

interface InviteRow {
  token: string;
  role: string;
  facility: string;
  calling_number: string;
  created_by: string;
  created_at: string;
  used_at: string | null;
  used_by_name: string | null;
}

function serialize(i: InviteRow) {
  return {
    token: i.token,
    role: i.role,
    roleLabel: ROLE_LABEL[i.role] ?? i.role,
    facility: i.facility,
    callingNumber: i.calling_number,
    createdBy: i.created_by,
    createdAt: i.created_at,
    usedAt: i.used_at ?? "",
    usedByName: i.used_by_name ?? "",
  };
}

interface NewInviteBody {
  role: string;
  facility: string;
  callingNumber: string;
  createdBy: string;
}

export default route({
  GET: async (_req, res) => {
    const { rows } = await query<InviteRow>(
      `select i.token, i.role, i.facility, i.calling_number, i.created_by, i.created_at, i.used_at, a.name as used_by_name
       from invites i
       left join accounts a on a.employee_id = i.used_by
       order by i.created_at desc`,
    );
    res.status(200).json(rows.map(serialize));
  },

  POST: async (req, res) => {
    const b = body<NewInviteBody>(req);
    const { rows } = await query<InviteRow>(
      `insert into invites (role, facility, calling_number, created_by)
       values ($1,$2,$3,$4)
       returning token, role, facility, calling_number, created_by, created_at, used_at, null as used_by_name`,
      [b.role, b.facility, b.callingNumber.trim(), b.createdBy],
    );
    res.status(201).json(serialize(rows[0]));
  },
});
