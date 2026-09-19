import { useMemo, useRef, useState } from "react";
import styles from "./Supervisor.module.css";
import { useAuth } from "../../context/AuthContext";
import { listAccounts } from "../../api/auth";
import {
  getQueueStats,
  getTodayStatsByAgent,
  getLeadsPastTarget,
  getOverdueCallbacks,
  getEscalatedLeads,
  unescalateLead,
  getAllLeads,
  listCdrMonths,
  saveCdrMonth,
  LEAD_TYPES,
  type CdrRow,
} from "../../api/leads";

const TARGET_MIN = 5;

function ageLabel(ms: number): string {
  const m = Math.floor(ms / 60000);
  return m < 60 ? m + "m" : Math.floor(m / 60) + "h";
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
  const { user, signOut } = useAuth();
  const [tab, setTab] = useState<"live" | "month">("live");
  const [flash, setFlash] = useState("");
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [monthOffset, setMonthOffset] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!user) return null;
  const currentUser = user;
  const initials = currentUser.name.split(" ").map((w) => w[0]).join("").slice(0, 2);

  const queueStats = getQueueStats();
  const dayStats = getTodayStatsByAgent();
  const agents = listAccounts().filter((a) => a.role === "agent");
  const pastTarget = getLeadsPastTarget(TARGET_MIN).filter((l) => !dismissed.includes("target:" + l.id));
  const overdueCallbacks = getOverdueCallbacks().filter((l) => !dismissed.includes("cb:" + l.id));
  const escalated = getEscalatedLeads();

  const openLeads = getAllLeads().filter((l) => l.status === "waiting" || l.status === "trying");
  const leadTypeBreakdown = LEAD_TYPES.map((t) => ({
    ...t,
    count: openLeads.filter((l) => l.leadType === t.code).length,
  })).filter((t) => t.count > 0);

  const dayRows = agents
    .map((a) => {
      const s = dayStats.find((d) => d.agentId === a.employeeId);
      return { name: a.name, id: a.employeeId, worked: s?.worked ?? 0, outcomes: s?.outcomes ?? 0, booked: s?.booked ?? 0, noAnswer: s?.noAnswer ?? 0 };
    })
    .sort((a, b) => b.booked - a.booked);
  const topBooked = Math.max(1, ...dayRows.map((r) => r.booked));

  const months = [2, 1, 0].map((o) => monthKeyOf(o));
  const activeMonth = monthKeyOf(monthOffset);
  const cdrMonths = listCdrMonths();
  const cdr = cdrMonths[activeMonth.key];

  const monthReport = useMemo(() => {
    if (!cdr) return null;
    const byExt = new Map<string, CdrRow[]>();
    for (const row of cdr.rows) {
      if (!byExt.has(row.extension)) byExt.set(row.extension, []);
      byExt.get(row.extension)!.push(row);
    }
    const [y, m] = activeMonth.key.split("-").map(Number);
    const perAgent = agents.map((a) => {
      const rows = a.callingNumber ? (byExt.get(a.callingNumber) ?? []) : [];
      const dials = rows.length;
      const connectedRows = rows.filter((r) => r.connected);
      const connected = connectedRows.length;
      const talkSec = connectedRows.reduce((n, r) => n + r.durationSec, 0);
      const loggedConnected = getAllLeads().reduce((n, lead) => {
        return (
          n +
          lead.history.filter((h) => {
            const d = new Date(h.whenISO);
            return h.agentId === a.employeeId && h.l1 === "connected" && d.getFullYear() === y && d.getMonth() === m - 1;
          }).length
        );
      }, 0);
      const bookedCount = getAllLeads().reduce((n, lead) => {
        return (
          n +
          lead.history.filter((h) => {
            const d = new Date(h.whenISO);
            return h.agentId === a.employeeId && (h.l2 === "appointment_booked" || h.l2 === "appointment_purchased") && d.getFullYear() === y && d.getMonth() === m - 1;
          }).length
        );
      }, 0);
      return {
        name: a.name,
        id: a.employeeId,
        dials,
        connected,
        rate: dials ? Math.round((connected / dials) * 100) : 0,
        talkSec,
        booked: bookedCount,
        missing: Math.max(0, connected - loggedConnected),
      };
    });
    const totalDials = perAgent.reduce((n, r) => n + r.dials, 0);
    const totalConnected = perAgent.reduce((n, r) => n + r.connected, 0);
    const totalTalk = perAgent.reduce((n, r) => n + r.talkSec, 0);
    const totalBooked = perAgent.reduce((n, r) => n + r.booked, 0);
    const totalMissing = perAgent.reduce((n, r) => n + r.missing, 0);
    return { perAgent: perAgent.sort((a, b) => b.booked - a.booked), totalDials, totalConnected, totalTalk, totalBooked, totalMissing };
  }, [cdr, activeMonth.key, agents]);

  function handleFile(file: File) {
    file.text().then((text) => {
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
      saveCdrMonth(activeMonth.key, {
        fileName: file.name,
        uploadedAt: new Date().toLocaleString(),
        uploadedBy: `${currentUser.employeeId} ${currentUser.name}`,
        monthKey: activeMonth.key,
        rows,
      });
      setFlash(`${rows.length.toLocaleString()} call records loaded for ${activeMonth.label}.`);
    });
  }

  const queueOnlyThisMonth = useMemo(() => {
    const [y, m] = activeMonth.key.split("-").map(Number);
    const leads = getAllLeads().filter((l) => {
      const d = new Date(l.createdAt);
      return d.getFullYear() === y && d.getMonth() === m - 1;
    });
    const outcomes = leads.reduce((n, l) => n + l.history.length, 0);
    const booked = leads.filter((l) => l.status === "booked").length;
    return { received: leads.length, outcomes, booked };
  }, [activeMonth.key]);

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
        {(["live", "month"] as const).map((t) => (
          <button
            key={t}
            type="button"
            className={styles.tabBtn}
            style={tab === t ? { background: "var(--primary)", color: "#fff", borderColor: "var(--primary)" } : undefined}
            onClick={() => setTab(t)}
          >
            {t === "live" ? "Live floor" : "Monthly report"}
          </button>
        ))}
      </div>

      <div className={styles.main}>
        {flash && <div className={styles.flash}>{flash}</div>}

        {tab === "live" ? (
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
                      <span className={styles.alertAge}>{ageLabel(Date.now() - Date.parse(l.createdAt))}</span>
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
                {pastTarget.length === 0 && overdueCallbacks.length === 0 && (
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
                      onClick={() => {
                        unescalateLead(l.id);
                        setFlash(`${l.name} returned to the queue.`);
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
                        {cdr.rows.length.toLocaleString()} call records · uploaded {cdr.uploadedAt} by {cdr.uploadedBy}
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
                    {monthReport.perAgent.map((r) => (
                      <div key={r.id} className={styles.tableRow}>
                        <div style={{ flex: "1 1 200px" }} className={styles.tableName}>{r.name}</div>
                        <div style={{ width: 90 }} className={styles.tableCell}>{r.dials}</div>
                        <div style={{ width: 90, color: r.rate < 50 ? "var(--danger)" : "var(--ink)" }} className={styles.tableCell}>{r.rate}%</div>
                        <div style={{ width: 90 }} className={styles.tableCell}>{Math.round(r.talkSec / 60)}m</div>
                        <div style={{ width: 90, color: "var(--success)" }} className={styles.tableCell}>{r.booked}</div>
                      </div>
                    ))}
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
