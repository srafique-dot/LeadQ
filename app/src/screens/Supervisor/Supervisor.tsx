import { useEffect, useRef, useState } from "react";
import styles from "./Supervisor.module.css";
import { useAuth } from "../../context/AuthContext";
import {
  getSupervisorStats,
  unescalateLead,
  reassignLead,
  getAllLeads,
  getCdrMonth,
  saveCdrMonth,
  leadTypeLabel,
  LEAD_TYPES,
  LEVEL1,
  LEVEL2,
  type CdrRow,
  type CdrMonth,
  type SupervisorStats,
} from "../../api/leads";
import type { Lead } from "../../api/types";
import { cohortColor } from "../../lib/cohortColor";

const TARGET_MIN = 5;

function ageLabel(ms: number): string {
  const m = Math.floor(ms / 60000);
  return m < 60 ? m + "m" : Math.floor(m / 60) + "h";
}

function slaColor(ms: number): string {
  const m = ms / 60000;
  return m <= 5 ? "var(--success)" : m <= 20 ? "var(--warning)" : "var(--danger)";
}

function monthKeyOf(offset: number): { key: string; label: string } {
  const d = new Date();
  d.setMonth(d.getMonth() - offset);
  const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  const label = d.toLocaleString("en-US", { month: "short", year: "numeric" });
  return { key, label };
}

function parseCdrCsv(text: string): CdrRow[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return [];
  const split = (l: string) => l.split(",").map((c) => c.trim());
  const first = split(lines[0]);
  const hasHeader = /extension/i.test(first[0] ?? "");
  const rows = hasHeader ? lines.slice(1) : lines;
  return rows
    .map(split)
    .filter((c) => c.length >= 5)
    .map((c) => ({
      extension: c[0],
      numberDialled: c[1],
      startTime: c[2],
      durationSec: Number(c[3]) || 0,
      connected: /^(1|true|yes|connected)$/i.test(c[4]),
    }));
}

export function Supervisor() {
  const { user, accounts, signOut } = useAuth();
  const [tab, setTab] = useState<"floor" | "queue" | "all" | "month">("floor");
  const [flash, setFlash] = useState("");
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [monthOffset, setMonthOffset] = useState(0);
  const [queueSearch, setQueueSearch] = useState("");
  const [queueStatusFilter, setQueueStatusFilter] = useState<"all" | "waiting" | "trying">("all");
  const [allSearch, setAllSearch] = useState("");
  const [allChannelFilter, setAllChannelFilter] = useState("all");
  const [allTypeFilter, setAllTypeFilter] = useState("all");
  const [allStatusFilter, setAllStatusFilter] = useState("all");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [stats, setStats] = useState<SupervisorStats | null>(null);
  const [allLeads, setAllLeads] = useState<Lead[]>([]);
  const [cdr, setCdr] = useState<CdrMonth | null>(null);

  const months = [2, 1, 0].map((o) => monthKeyOf(o));
  const activeMonth = monthKeyOf(monthOffset);

  function refreshLive() {
    getSupervisorStats().then(setStats);
    getAllLeads().then(setAllLeads);
  }

  useEffect(() => {
    if (user) refreshLive();
  }, [user?.employeeId]);

  useEffect(() => {
    if (user) getCdrMonth(activeMonth.key).then(setCdr);
  }, [user?.employeeId, activeMonth.key]);

  if (!user) return null;
  const currentUser = user;
  const initials = currentUser.name.split(" ").map((w) => w[0]).join("").slice(0, 2);

  const queueStats = stats?.queue ?? { waiting: 0, oldestWaitMin: 0, workedToday: 0, outcomesToday: 0, bookedToday: 0 };
  const dayStats = stats?.dayStatsByAgent ?? [];
  const agents = accounts.filter((a) => a.role === "agent");
  const pastTarget = (stats?.pastTarget ?? []).filter((l) => !dismissed.includes("target:" + l.id));
  const overdueCallbacks = (stats?.overdueCallbacks ?? []).filter((l) => !dismissed.includes("cb:" + l.id));
  const escalated = stats?.escalated ?? [];
  const abandoned = stats?.abandoned ?? [];
  const roster = stats?.roster ?? [];
  const PRESENCE_LABEL: Record<string, { text: string; color: string }> = {
    available: { text: "Available", color: "var(--success)" },
    break: { text: "On break", color: "var(--warning)" },
    off: { text: "Signed off", color: "var(--ink-faint)" },
  };

  const openLeads = allLeads.filter((l) => l.status === "waiting" || l.status === "trying");
  const leadTypeBreakdown = LEAD_TYPES.map((t) => ({
    ...t,
    count: openLeads.filter((l) => l.leadType === t.code).length,
  })).filter((t) => t.count > 0);

  // Same ordering agents actually pull from: urgent first, then oldest first.
  const queueRows = openLeads
    .filter((l) => queueStatusFilter === "all" || l.status === queueStatusFilter)
    .filter((l) => {
      const t = queueSearch.trim().toLowerCase();
      return !t || (l.name + l.phone).toLowerCase().includes(t);
    })
    .sort((a, b) => (b.urgent ? 1 : 0) - (a.urgent ? 1 : 0) || Date.parse(a.createdAt) - Date.parse(b.createdAt));

  const channelNames = Array.from(new Set(allLeads.map((l) => l.channel).filter(Boolean))).sort();
  const channelBreakdown = channelNames.map((name) => {
    const rows = allLeads.filter((l) => l.channel === name);
    const booked = rows.filter((l) => l.status === "booked").length;
    const closed = rows.filter((l) => l.status === "closed").length;
    const open = rows.length - booked - closed;
    return { name, total: rows.length, booked, closed, open, bookedPct: rows.length ? Math.round((booked / rows.length) * 100) : 0 };
  });

  const DISPLAY_CAP = 300;
  const allFilteredLeads = allLeads
    .filter((l) => allChannelFilter === "all" || l.channel === allChannelFilter)
    .filter((l) => allTypeFilter === "all" || l.leadType === allTypeFilter)
    .filter((l) => allStatusFilter === "all" || l.status === allStatusFilter)
    .filter((l) => {
      const t = allSearch.trim().toLowerCase();
      return !t || (l.name + l.phone + l.cohort).toLowerCase().includes(t);
    })
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const allDisplayLeads = allFilteredLeads.slice(0, DISPLAY_CAP);

  function exportAllLeadsCsv() {
    const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const header = [
      "Lead ID", "Caller name", "Caller phone", "Patient name (if different)", "Channel", "Cohort", "Facility",
      "Lead type", "Status", "Latest outcome", "ERP ref type", "ERP ref value", "Created", "Latest disposition",
      "Requester", "Last agent", "Urgent",
    ];
    const rows = allFilteredLeads.map((l) => {
      const last = l.history[l.history.length - 1];
      const outcome = last ? (LEVEL2.find((o) => o.code === last.l2)?.label ?? LEVEL1.find((o) => o.code === last.l1)?.label ?? "") : "";
      return [
        l.id, l.name, l.phone, l.patientName, l.channel, l.cohort, l.facility,
        leadTypeLabel(l.leadType), l.status, outcome, l.erpRefType, l.erpRefValue, l.createdAt, last?.when ?? "",
        `${l.ownerId} ${l.ownerName}`, last?.agentName ?? "", l.urgent ? "yes" : "no",
      ].map((v) => escape(String(v ?? "")));
    });
    const csv = [header.map(escape), ...rows].map((r) => r.join(",")).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `leadq-leads-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const dayRows = agents
    .map((a) => {
      const s = dayStats.find((d) => d.agentId === a.employeeId);
      return { name: a.name, id: a.employeeId, worked: s?.worked ?? 0, outcomes: s?.outcomes ?? 0, booked: s?.booked ?? 0, noAnswer: s?.noAnswer ?? 0 };
    })
    .sort((a, b) => b.booked - a.booked);
  const topBooked = Math.max(1, ...dayRows.map((r) => r.booked));

  const monthReport = cdr
    ? {
        perAgent: cdr.perAgent,
        totalDials: cdr.perAgent.reduce((n, r) => n + r.dials, 0),
        totalConnected: cdr.perAgent.reduce((n, r) => n + r.connected, 0),
        totalTalk: cdr.perAgent.reduce((n, r) => n + r.talkSec, 0),
        totalBooked: cdr.perAgent.reduce((n, r) => n + r.booked, 0),
        totalMissing: cdr.perAgent.reduce((n, r) => n + r.missing, 0),
      }
    : null;

  function handleFile(file: File) {
    file.text().then(async (text) => {
      const rows = parseCdrCsv(text);
      if (!rows.length) {
        setFlash("Couldn't read any rows from that file — check the columns match: extension, number dialled, start time, duration (sec), connected.");
        return;
      }
      const perAgentDials = new Map<string, number>();
      for (const r of rows) perAgentDials.set(r.extension, (perAgentDials.get(r.extension) ?? 0) + 1);
      const sumDials = Array.from(perAgentDials.values()).reduce((n, v) => n + v, 0);
      if (sumDials !== rows.length) {
        setFlash("File failed the integrity check — the record count doesn't match the sum of per-extension dials.");
        return;
      }
      await saveCdrMonth(activeMonth.key, file.name, `${currentUser.employeeId} ${currentUser.name}`, rows);
      const fresh = await getCdrMonth(activeMonth.key);
      setCdr(fresh);
      setFlash(`${rows.length.toLocaleString()} call records loaded for ${activeMonth.label}.`);
    });
  }

  const queueOnlyThisMonth = (() => {
    const [y, m] = activeMonth.key.split("-").map(Number);
    const leads = allLeads.filter((l) => {
      const d = new Date(l.createdAt);
      return d.getFullYear() === y && d.getMonth() === m - 1;
    });
    const outcomes = leads.reduce((n, l) => n + l.history.length, 0);
    const booked = leads.filter((l) => l.status === "booked").length;
    return { received: leads.length, outcomes, booked };
  })();

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <img src="/assets/umch-logo.png" alt="United Healthcare" />
        <span className={styles.headerTitle}>Floor view</span>
        <div className={styles.headerUser}>
          <span className={styles.avatar}>{initials}</span>
          <div>
            <div className={styles.headerName}>{currentUser.name}</div>
            <div className={styles.headerMeta}>
              {currentUser.employeeId} · Team lead
              <button type="button" className={styles.signOutBtn} onClick={signOut}>
                Sign out
              </button>
            </div>
          </div>
        </div>
      </header>

      <div className={styles.tabs}>
        {(["floor", "queue", "all", "month"] as const).map((t) => (
          <button
            key={t}
            type="button"
            className={styles.tabBtn}
            style={tab === t ? { background: "var(--primary)", color: "#fff", borderColor: "var(--primary)" } : undefined}
            onClick={() => setTab(t)}
          >
            {t === "floor" ? "Floor view" : t === "queue" ? "Agent queue" : t === "all" ? "All leads" : "Monthly report"}
          </button>
        ))}
      </div>

      <div className={styles.main}>
        {flash && <div className={styles.flash}>{flash}</div>}

        {tab === "floor" ? (
          <div>
            <div style={{ display: "flex", alignItems: "center" }}>
              <h1 className={styles.title}>The floor right now</h1>
              <span className={styles.liveDot}>
                <span className={styles.pulseDot} />
                <span className={styles.liveDotText}>Live</span>
              </span>
            </div>
            <div className={styles.subhead}>
              Queue state and what agents have logged. Call duration and dial history come from the phone system — see the monthly report.
            </div>

            <div className={styles.tileGrid}>
              <div className={styles.tile}>
                <div className={styles.tileValue} style={{ color: queueStats.waiting > 10 ? "var(--danger)" : "var(--ink)" }}>
                  {queueStats.waiting}
                </div>
                <div className={styles.tileLabel}>Leads waiting for a call</div>
                <div className={styles.tileSub} style={{ color: "var(--danger)" }}>oldest {ageLabel(queueStats.oldestWaitMin * 60000)}</div>
              </div>
              <div className={styles.tile}>
                <div className={styles.tileValue}>{queueStats.workedToday}</div>
                <div className={styles.tileLabel}>Leads worked today</div>
              </div>
              <div className={styles.tile}>
                <div className={styles.tileValue}>{queueStats.outcomesToday}</div>
                <div className={styles.tileLabel}>Outcomes logged today</div>
              </div>
              <div className={styles.tile}>
                <div className={styles.tileValue} style={{ color: "var(--success)" }}>{queueStats.bookedToday}</div>
                <div className={styles.tileLabel}>Booked</div>
                <div className={styles.tileSub} style={{ color: "var(--ink-faint)" }}>
                  {queueStats.outcomesToday ? Math.round((queueStats.bookedToday / queueStats.outcomesToday) * 100) : 0}% of outcomes
                </div>
              </div>
              <div className={styles.tile}>
                <div className={styles.tileValue} style={{ color: pastTarget.length ? "var(--danger)" : "var(--ink)" }}>{pastTarget.length}</div>
                <div className={styles.tileLabel}>Past the {TARGET_MIN}-min first-call target</div>
              </div>
              <div className={styles.tile}>
                <div className={styles.tileValue} style={{ color: escalated.length ? "var(--warning)" : "var(--ink)" }}>{escalated.length}</div>
                <div className={styles.tileLabel}>Sent to you by agents</div>
              </div>
            </div>

            {leadTypeBreakdown.length > 0 && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", margin: "4px 0 20px" }}>
                <span style={{ fontSize: 13, color: "var(--ink-faint)", fontWeight: 600 }}>Open leads by enquiry type</span>
                {leadTypeBreakdown.map((t) => (
                  <span
                    key={t.code}
                    style={{
                      fontSize: 13,
                      padding: "4px 10px",
                      borderRadius: 999,
                      background: "var(--surface-subtle)",
                      border: "1px solid var(--border-light)",
                      color: "var(--ink-secondary)",
                    }}
                  >
                    {t.label} <strong>{t.count}</strong>
                  </span>
                ))}
              </div>
            )}

            <div className={styles.splitGrid}>
              <div className={styles.card}>
                <div className={styles.cardHead}>
                  <span className={styles.cardHeadTitle}>Needs you now</span>
                </div>
                {pastTarget.map((l) => (
                  <div key={l.id} className={styles.alertRow}>
                    <div className={styles.alertTop}>
                      <span className={styles.alertDot} style={{ background: "var(--danger)" }} />
                      <span className={styles.alertTitle}>{l.name}</span>
                      <span className={styles.alertAge}>{ageLabel(Date.now() - Date.parse(l.createdAt!))}</span>
                    </div>
                    <div className={styles.alertDetail}>
                      Nobody has called yet · {l.facility}{l.urgent ? " · marked urgent" : ""}
                    </div>
                    <button type="button" className={styles.alertBtn} onClick={() => setDismissed((d) => [...d, "target:" + l.id])}>
                      Seen — dismiss
                    </button>
                  </div>
                ))}
                {overdueCallbacks.map((l) => (
                  <div key={l.id} className={styles.alertRow}>
                    <div className={styles.alertTop}>
                      <span className={styles.alertDot} style={{ background: "var(--warning)" }} />
                      <span className={styles.alertTitle}>{l.name}</span>
                      <span className={styles.alertAge}>due {l.nextActionDate}</span>
                    </div>
                    <div className={styles.alertDetail}>A promised callback has passed its date · {l.facility}</div>
                    <button type="button" className={styles.alertBtn} onClick={() => setDismissed((d) => [...d, "cb:" + l.id])}>
                      Seen — dismiss
                    </button>
                  </div>
                ))}
                {abandoned.map((a) => (
                  <div key={a.id} className={styles.alertRow}>
                    <div className={styles.alertTop}>
                      <span className={styles.alertDot} style={{ background: "var(--danger)" }} />
                      <span className={styles.alertTitle}>{a.name}</span>
                      <span className={styles.alertAge}>{a.heldMin}m</span>
                    </div>
                    <div className={styles.alertDetail}>
                      {a.claimedByName} opened this and hasn't logged an outcome — they may have left mid-call.
                    </div>
                    <button
                      type="button"
                      className={styles.alertBtn}
                      onClick={async () => {
                        await reassignLead(a.id, null);
                        setFlash(`${a.name} released back to the floor.`);
                        refreshLive();
                      }}
                    >
                      Release back to the floor
                    </button>
                  </div>
                ))}
                {pastTarget.length === 0 && overdueCallbacks.length === 0 && abandoned.length === 0 && (
                  <div className={styles.emptyRow}>Nothing breaching. The queue is inside target.</div>
                )}
                <div className={styles.footnote}>
                  This only reflects what the app can see: queue age and scheduled callbacks. It cannot tell you who is on the phone right now.
                </div>
              </div>

              <div className={styles.card}>
                <div className={styles.cardHead}>
                  <span className={styles.cardHeadTitle}>Sent to you by agents</span>
                </div>
                {escalated.map((l) => (
                  <div key={l.id} className={styles.alertRow}>
                    <div className={styles.alertTop}>
                      <span className={styles.alertTitle}>{l.name}</span>
                    </div>
                    <div className={styles.alertDetail}>By {l.escalatedBy} · {l.escalatedAt}</div>
                    <button
                      type="button"
                      className={styles.alertBtn}
                      onClick={async () => {
                        await unescalateLead(l.id);
                        setFlash(`${l.name} returned to the queue.`);
                        refreshLive();
                      }}
                    >
                      Return to queue
                    </button>
                  </div>
                ))}
                {escalated.length === 0 && <div className={styles.emptyRow}>Nothing escalated right now.</div>}
              </div>
            </div>

            <div className={styles.card} style={{ marginTop: 14 }}>
              <div className={styles.cardHead}>
                <span className={styles.cardHeadTitle}>Who's on the floor</span>
                <span style={{ marginLeft: "auto", fontSize: 12.5, color: "var(--ink-faint)" }}>
                  Agents set this themselves — it isn't guessed from activity
                </span>
              </div>
              <div className={styles.tableHeadRow}>
                <div style={{ flex: "1 1 200px" }} className={styles.tableHeadCell}>AGENT</div>
                <div style={{ width: 120 }} className={styles.tableHeadCell}>STATUS</div>
                <div style={{ width: 100, textAlign: "right" }} className={styles.tableHeadCell}>HOLDING</div>
                <div style={{ width: 160 }} className={styles.tableHeadCell}>ON A CALL WITH</div>
              </div>
              {roster.map((r) => {
                const p = PRESENCE_LABEL[r.presence] ?? PRESENCE_LABEL.off;
                return (
                  <div key={r.agentId} className={styles.tableRow}>
                    <div style={{ flex: "1 1 200px" }} className={styles.tableName}>{r.agentName}</div>
                    <div style={{ width: 120, color: p.color, textAlign: "left" }} className={styles.tableCell}>{p.text}</div>
                    <div style={{ width: 100 }} className={styles.tableCell}>{r.assigned}</div>
                    <div style={{ width: 160, textAlign: "left" }} className={styles.tableCell}>{r.onCall || "—"}</div>
                  </div>
                );
              })}
              {roster.length === 0 && <div className={styles.emptyRow}>No agents on the roster yet.</div>}
            </div>

            <div className={styles.card} style={{ marginTop: 14 }}>
              <div className={styles.cardHead}>
                <span className={styles.cardHeadTitle}>Logged today, by agent</span>
                <span style={{ marginLeft: "auto", fontSize: 12.5, color: "var(--ink-faint)" }}>Outcomes agents typed in</span>
              </div>
              <div className={styles.tableHeadRow}>
                <div style={{ flex: "1 1 200px" }} className={styles.tableHeadCell}>AGENT</div>
                <div style={{ width: 90, textAlign: "right" }} className={styles.tableHeadCell}>WORKED</div>
                <div style={{ width: 90, textAlign: "right" }} className={styles.tableHeadCell}>OUTCOMES</div>
                <div style={{ width: 90, textAlign: "right" }} className={styles.tableHeadCell}>BOOKED</div>
                <div style={{ width: 90, textAlign: "right" }} className={styles.tableHeadCell}>BOOK %</div>
              </div>
              {dayRows.map((r) => {
                const pct = r.outcomes ? Math.round((r.booked / r.outcomes) * 100) : 0;
                return (
                  <div key={r.id} className={styles.tableRow}>
                    <div style={{ flex: "1 1 200px", minWidth: 0 }}>
                      <div className={styles.tableName}>{r.name}</div>
                      <div className={styles.tableBar}>
                        <div className={styles.tableBarFill} style={{ width: `${Math.round((r.booked / topBooked) * 100)}%`, background: "var(--primary)" }} />
                      </div>
                    </div>
                    <div style={{ width: 90 }} className={styles.tableCell}>{r.worked}</div>
                    <div style={{ width: 90 }} className={styles.tableCell}>{r.outcomes}</div>
                    <div style={{ width: 90, color: "var(--success)" }} className={styles.tableCell}>{r.booked}</div>
                    <div style={{ width: 90, color: pct < 20 ? "var(--danger)" : "var(--ink)" }} className={styles.tableCell}>{pct}%</div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : tab === "queue" ? (
          <div>
            <h1 className={styles.title}>Agent queue</h1>
            <div className={styles.subhead}>
              Every open lead, in the order an agent would actually pull it — urgent first, then oldest first. Leads are routed to an agent
              and stay with whoever last spoke to the caller; reassign here to move one.
            </div>

            <div style={{ display: "flex", gap: 9, flexWrap: "wrap", margin: "14px 0" }}>
              <input
                value={queueSearch}
                onChange={(e) => setQueueSearch(e.target.value)}
                placeholder="Search name or phone"
                style={{ flex: "1 1 240px", padding: "9px 12px", borderRadius: 7, border: "1px solid var(--border-input)", background: "var(--surface)", fontSize: 14, color: "var(--ink)" }}
              />
              {(["all", "waiting", "trying"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  className={styles.tabBtn}
                  style={queueStatusFilter === s ? { background: "var(--primary)", color: "#fff", borderColor: "var(--primary)" } : undefined}
                  onClick={() => setQueueStatusFilter(s)}
                >
                  {s === "all" ? "All" : s === "waiting" ? "Waiting" : "Being called"}
                </button>
              ))}
            </div>

            <div className={styles.card}>
              <div className={styles.tableHeadRow}>
                <div style={{ flex: "1 1 220px" }} className={styles.tableHeadCell}>LEAD</div>
                <div style={{ width: 130 }} className={styles.tableHeadCell}>TYPE</div>
                <div style={{ width: 100 }} className={styles.tableHeadCell}>STATUS</div>
                <div style={{ width: 190 }} className={styles.tableHeadCell}>ROUTED TO</div>
                <div style={{ width: 70, textAlign: "right" }} className={styles.tableHeadCell}>AGE</div>
              </div>
              {queueRows.map((l) => (
                <div key={l.id} className={styles.tableRow}>
                  <div style={{ flex: "1 1 220px", minWidth: 0, display: "flex", alignItems: "center", gap: 8 }}>
                    {l.cohort && <span style={{ width: 7, height: 7, borderRadius: "50%", flex: "0 0 auto", background: cohortColor(l.cohort).fg }} />}
                    <div style={{ minWidth: 0 }}>
                      <div className={styles.tableName}>
                        {l.name} {l.urgent && <span style={{ color: "var(--danger)", fontSize: 12, fontWeight: 700 }}>URGENT</span>}
                      </div>
                      <div style={{ fontSize: 12.5, color: "var(--ink-faint)" }}>{l.phone}</div>
                    </div>
                  </div>
                  <div style={{ width: 130 }} className={styles.tableCell}>{leadTypeLabel(l.leadType)}</div>
                  <div style={{ width: 100 }} className={styles.tableCell}>
                    {l.claimedBy ? "On a call" : l.status === "waiting" ? "Waiting" : "Being called"}
                  </div>
                  <div style={{ width: 190 }}>
                    <select
                      value={l.assignedTo || ""}
                      onChange={async (e) => {
                        await reassignLead(l.id, e.target.value || null);
                        setFlash(
                          e.target.value
                            ? `${l.name} reassigned to ${accounts.find((a) => a.employeeId === e.target.value)?.name ?? e.target.value}.`
                            : `${l.name} returned to the floor.`,
                        );
                        refreshLive();
                      }}
                      style={{ width: "100%", padding: "6px 8px", borderRadius: 6, border: "1px solid var(--border-input)", background: "var(--surface)", fontSize: 13 }}
                    >
                      <option value="">Unassigned — on the floor</option>
                      {agents.map((a) => (
                        <option key={a.employeeId} value={a.employeeId}>
                          {a.name}
                          {a.presence === "available" ? "" : a.presence === "break" ? " (on break)" : " (signed off)"}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div style={{ width: 70, textAlign: "right", color: slaColor(Date.now() - Date.parse(l.createdAt)) }} className={styles.tableCell}>
                    {ageLabel(Date.now() - Date.parse(l.createdAt))}
                  </div>
                </div>
              ))}
              {queueRows.length === 0 && <div className={styles.emptyRow}>Nothing matches — the queue is empty or the filter is too narrow.</div>}
            </div>
          </div>
        ) : tab === "all" ? (
          <div>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 14, flexWrap: "wrap" }}>
              <div>
                <h1 className={styles.title}>All leads</h1>
                <div className={styles.subhead}>
                  Every lead regardless of status, grouped by where it came from. Booking/payment truth lives in the ERP — the reference
                  columns are pointers into it, not a live sync.
                </div>
              </div>
              <button type="button" className={styles.uploadBtn} style={{ marginLeft: "auto" }} onClick={exportAllLeadsCsv}>
                Export CSV ({allFilteredLeads.length.toLocaleString()} rows)
              </button>
            </div>

            {channelBreakdown.length > 0 && (
              <div className={styles.card} style={{ marginTop: 14 }}>
                <div className={styles.cardHead}>
                  <span className={styles.cardHeadTitle}>By channel</span>
                </div>
                <div className={styles.tableHeadRow}>
                  <div style={{ flex: "1 1 160px" }} className={styles.tableHeadCell}>CHANNEL</div>
                  <div style={{ width: 80, textAlign: "right" }} className={styles.tableHeadCell}>TOTAL</div>
                  <div style={{ width: 80, textAlign: "right" }} className={styles.tableHeadCell}>OPEN</div>
                  <div style={{ width: 80, textAlign: "right" }} className={styles.tableHeadCell}>BOOKED</div>
                  <div style={{ width: 80, textAlign: "right" }} className={styles.tableHeadCell}>CLOSED</div>
                  <div style={{ width: 90, textAlign: "right" }} className={styles.tableHeadCell}>BOOK %</div>
                </div>
                {channelBreakdown.map((c) => (
                  <div key={c.name} className={styles.tableRow}>
                    <div style={{ flex: "1 1 160px" }} className={styles.tableName}>{c.name}</div>
                    <div style={{ width: 80 }} className={styles.tableCell}>{c.total}</div>
                    <div style={{ width: 80 }} className={styles.tableCell}>{c.open}</div>
                    <div style={{ width: 80, color: "var(--success)" }} className={styles.tableCell}>{c.booked}</div>
                    <div style={{ width: 80 }} className={styles.tableCell}>{c.closed}</div>
                    <div style={{ width: 90, color: c.bookedPct < 20 ? "var(--danger)" : "var(--ink)" }} className={styles.tableCell}>{c.bookedPct}%</div>
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: "flex", gap: 9, flexWrap: "wrap", margin: "14px 0" }}>
              <input
                value={allSearch}
                onChange={(e) => setAllSearch(e.target.value)}
                placeholder="Search name, phone or cohort"
                style={{ flex: "1 1 220px", padding: "9px 12px", borderRadius: 7, border: "1px solid var(--border-input)", background: "var(--surface)", fontSize: 14, color: "var(--ink)" }}
              />
              <select value={allChannelFilter} onChange={(e) => setAllChannelFilter(e.target.value)} style={{ padding: "9px 10px", borderRadius: 7, border: "1px solid var(--border-input)", background: "var(--surface)" }}>
                <option value="all">All channels</option>
                {channelNames.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <select value={allTypeFilter} onChange={(e) => setAllTypeFilter(e.target.value)} style={{ padding: "9px 10px", borderRadius: 7, border: "1px solid var(--border-input)", background: "var(--surface)" }}>
                <option value="all">All types</option>
                {LEAD_TYPES.map((t) => <option key={t.code} value={t.code}>{t.label}</option>)}
              </select>
              <select value={allStatusFilter} onChange={(e) => setAllStatusFilter(e.target.value)} style={{ padding: "9px 10px", borderRadius: 7, border: "1px solid var(--border-input)", background: "var(--surface)" }}>
                <option value="all">All statuses</option>
                <option value="waiting">Waiting</option>
                <option value="trying">Being called</option>
                <option value="booked">Booked</option>
                <option value="closed">Closed</option>
              </select>
            </div>

            <div className={styles.card}>
              <div className={styles.tableHeadRow}>
                <div style={{ flex: "1 1 200px" }} className={styles.tableHeadCell}>LEAD</div>
                <div style={{ width: 110 }} className={styles.tableHeadCell}>CHANNEL</div>
                <div style={{ width: 130 }} className={styles.tableHeadCell}>COHORT</div>
                <div style={{ width: 120 }} className={styles.tableHeadCell}>TYPE</div>
                <div style={{ width: 100 }} className={styles.tableHeadCell}>STATUS</div>
                <div style={{ width: 90 }} className={styles.tableHeadCell}>ERP REF</div>
              </div>
              {allDisplayLeads.map((l) => (
                <div key={l.id} className={styles.tableRow}>
                  <div style={{ flex: "1 1 200px", minWidth: 0 }}>
                    <div className={styles.tableName}>{l.name}</div>
                    <div style={{ fontSize: 12.5, color: "var(--ink-faint)" }}>
                      {l.phone}
                      {l.patientName ? ` · for ${l.patientName}` : ""}
                    </div>
                  </div>
                  <div style={{ width: 110 }} className={styles.tableCell}>{l.channel}</div>
                  <div style={{ width: 130 }} className={styles.tableCell}>{l.cohort || "—"}</div>
                  <div style={{ width: 120 }} className={styles.tableCell}>{leadTypeLabel(l.leadType)}</div>
                  <div style={{ width: 100 }} className={styles.tableCell}>
                    {l.status === "waiting" ? "Waiting" : l.status === "trying" ? "Being called" : l.status === "booked" ? "Booked" : "Closed"}
                  </div>
                  <div style={{ width: 90, color: l.erpRefValue ? "var(--ink)" : "var(--ink-faint)" }} className={styles.tableCell}>
                    {l.erpRefValue || "—"}
                  </div>
                </div>
              ))}
              {allDisplayLeads.length === 0 && <div className={styles.emptyRow}>Nothing matches this filter.</div>}
              {allFilteredLeads.length > DISPLAY_CAP && (
                <div className={styles.footnote} style={{ padding: "10px 16px" }}>
                  Showing the latest {DISPLAY_CAP} of {allFilteredLeads.length.toLocaleString()} matching leads — narrow the filter or use
                  Export CSV to get everything.
                </div>
              )}
            </div>
          </div>
        ) : (
          <div>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 14, flexWrap: "wrap" }}>
              <div>
                <h1 className={styles.title}>Monthly report</h1>
                <div className={styles.subhead}>
                  Call duration and dial counts come from the phone system's call record file. Upload it once a month.
                </div>
              </div>
              <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                {months.map((m, i) => {
                  const on = m.key === activeMonth.key;
                  return (
                    <button
                      key={m.key}
                      type="button"
                      className={styles.tabBtn}
                      style={on ? { background: "var(--primary)", color: "#fff", borderColor: "var(--primary)" } : undefined}
                      onClick={() => setMonthOffset(2 - i)}
                    >
                      {m.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {!cdr ? (
              <>
                <div className={styles.uploadPanel}>
                  <div className={styles.uploadTitle}>No call record file for {activeMonth.label} yet</div>
                  <div className={styles.uploadBody}>
                    Export the outbound CDR from the phone system and upload it here. One row per dialled call: agent extension, number dialled, start time, duration (seconds), and whether it connected.
                  </div>
                  <button type="button" className={styles.uploadBtn} onClick={() => fileInputRef.current?.click()}>
                    Upload the CDR file
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv,text/csv"
                    hidden
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleFile(f);
                      e.target.value = "";
                    }}
                  />
                  <div className={styles.uploadNote}>CSV · the queue side of this month is already recorded and shown below</div>
                </div>
                <div className={styles.card} style={{ marginTop: 14 }}>
                  <div className={styles.cardHead}>
                    <span className={styles.cardHeadTitle}>What this system knows for {activeMonth.label}</span>
                  </div>
                  <div className={styles.tileGrid} style={{ margin: "0", padding: 15 }}>
                    <div className={styles.tile}>
                      <div className={styles.tileValue}>{queueOnlyThisMonth.received}</div>
                      <div className={styles.tileLabel}>Leads received</div>
                    </div>
                    <div className={styles.tile}>
                      <div className={styles.tileValue}>{queueOnlyThisMonth.outcomes}</div>
                      <div className={styles.tileLabel}>Outcomes logged</div>
                    </div>
                    <div className={styles.tile}>
                      <div className={styles.tileValue} style={{ color: "var(--success)" }}>{queueOnlyThisMonth.booked}</div>
                      <div className={styles.tileLabel}>Booked</div>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              monthReport && (
                <>
                  <div className={styles.fileCard}>
                    <div>
                      <div className={styles.fileName}>{cdr.fileName}</div>
                      <div className={styles.fileMeta}>
                        {monthReport.totalDials.toLocaleString()} call records · uploaded {cdr.uploadedAt} by {cdr.uploadedBy}
                      </div>
                    </div>
                    <button type="button" className={styles.replaceBtn} onClick={() => fileInputRef.current?.click()}>
                      Replace file
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".csv,text/csv"
                      hidden
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) handleFile(f);
                        e.target.value = "";
                      }}
                    />
                  </div>

                  <div className={styles.tileGrid}>
                    <div className={styles.tile}>
                      <div className={styles.tileValue}>{monthReport.totalDials.toLocaleString()}</div>
                      <div className={styles.tileLabel}>Calls dialled</div>
                    </div>
                    <div className={styles.tile}>
                      <div className={styles.tileValue}>{monthReport.totalDials ? Math.round((monthReport.totalConnected / monthReport.totalDials) * 100) : 0}%</div>
                      <div className={styles.tileLabel}>Connected</div>
                    </div>
                    <div className={styles.tile}>
                      <div className={styles.tileValue}>{Math.round(monthReport.totalTalk / 3600)}h</div>
                      <div className={styles.tileLabel}>Total talk time</div>
                    </div>
                    <div className={styles.tile}>
                      <div className={styles.tileValue} style={{ color: "var(--success)" }}>{monthReport.totalBooked}</div>
                      <div className={styles.tileLabel}>Booked</div>
                    </div>
                    <div className={styles.tile}>
                      <div className={styles.tileValue} style={{ color: monthReport.totalMissing ? "var(--danger)" : "var(--ink)" }}>{monthReport.totalMissing}</div>
                      <div className={styles.tileLabel}>Connected calls with no outcome logged</div>
                    </div>
                  </div>

                  <div className={styles.reconCard}>
                    <div className={styles.reconHead}>
                      <div className={styles.reconTitle}>Calls dialled vs outcomes logged</div>
                      <div className={styles.reconLine}>
                        {monthReport.totalMissing} connected calls in the file have no matching outcome in the queue. Either the agent called from their own phone, or they did not log it.
                      </div>
                    </div>
                    {monthReport.perAgent.filter((r) => r.missing > 0).map((r) => (
                      <div key={r.id} className={styles.reconRow}>
                        <div>
                          <div className={styles.reconName}>{r.name}</div>
                          <div className={styles.reconDetail}>{r.connected} connected in the file · {r.connected - r.missing} outcomes matched</div>
                        </div>
                        <div className={styles.reconGap} style={{ color: r.missing > 20 ? "var(--danger)" : "var(--warning)" }}>{r.missing} unlogged</div>
                      </div>
                    ))}
                  </div>

                  <div className={styles.card} style={{ marginTop: 14 }}>
                    <div className={styles.cardHead}>
                      <span className={styles.cardHeadTitle}>{activeMonth.label} by agent</span>
                    </div>
                    <div className={styles.tableHeadRow}>
                      <div style={{ flex: "1 1 200px" }} className={styles.tableHeadCell}>AGENT</div>
                      <div style={{ width: 90, textAlign: "right" }} className={styles.tableHeadCell}>DIALLED</div>
                      <div style={{ width: 90, textAlign: "right" }} className={styles.tableHeadCell}>CONNECT %</div>
                      <div style={{ width: 90, textAlign: "right" }} className={styles.tableHeadCell}>TALK</div>
                      <div style={{ width: 90, textAlign: "right" }} className={styles.tableHeadCell}>BOOKED</div>
                    </div>
                    {monthReport.perAgent.map((r) => {
                      const rate = r.dials ? Math.round((r.connected / r.dials) * 100) : 0;
                      return (
                        <div key={r.id} className={styles.tableRow}>
                          <div style={{ flex: "1 1 200px" }} className={styles.tableName}>{r.name}</div>
                          <div style={{ width: 90 }} className={styles.tableCell}>{r.dials}</div>
                          <div style={{ width: 90, color: rate < 50 ? "var(--danger)" : "var(--ink)" }} className={styles.tableCell}>{rate}%</div>
                          <div style={{ width: 90 }} className={styles.tableCell}>{Math.round(r.talkSec / 60)}m</div>
                          <div style={{ width: 90, color: "var(--success)" }} className={styles.tableCell}>{r.booked}</div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )
            )}
          </div>
        )}
      </div>
    </div>
  );
}
