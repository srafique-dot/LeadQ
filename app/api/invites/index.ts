import { query } from "../_db.js";
import { route, body } from "../_http.js";
import { allow } from "../_auth.js";

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
  default_channel: string;
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
    defaultChannel: i.default_channel,
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
  defaultChannel?: string;
}

export default route({
  GET: async (_req, res, session) => {
    if (!allow(res, session, "superadmin")) return;
    const { rows } = await query<InviteRow>(
      `select i.token, i.role, i.facility, i.calling_number, i.default_channel, i.created_by, i.created_at, i.used_at, a.name as used_by_name
       from invites i
       left join accounts a on a.employee_id = i.used_by
       order by i.created_at desc`,
    );
    res.status(200).json(rows.map(serialize));
  },

  POST: async (req, res, session) => {
    if (!allow(res, session, "superadmin")) return;
    const b = body<NewInviteBody>(req);
    // Only meaningful for requesters — agents/admins/superadmins have no
    // Add-lead form to pre-fill.
    const defaultChannel = b.role === "requester" ? (b.defaultChannel ?? "").trim() : "";
    const { rows } = await query<InviteRow>(
      `insert into invites (role, facility, calling_number, default_channel, created_by)
       values ($1,$2,$3,$4,$5)
       returning token, role, facility, calling_number, default_channel, created_by, created_at, used_at, null as used_by_name`,
      [b.role, b.facility ?? "", (b.callingNumber ?? "").trim(), defaultChannel, session.employeeId],
    );
    res.status(201).json(serialize(rows[0]));
  },
});
