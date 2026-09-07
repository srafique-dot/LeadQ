import { useState } from "react";
import styles from "./Requester.module.css";
import { useAuth } from "../../context/AuthContext";
import { listLeadsForOwner, serviceLine } from "../../api/leads";
import { STATUS_STYLE } from "./statusStyles";
import { AddLeadModal } from "./components/AddLeadModal";
import { ImportModal } from "./components/ImportModal";

type Filter = "all" | "open" | "booked" | "closed";
const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "open", label: "Open" },
  { key: "booked", label: "Booked" },
  { key: "closed", label: "Closed" },
];

function initials(name: string): string {
  return name.split(" ").map((w) => w[0]).join("").slice(0, 2);
}

export function Requester() {
  const { user, signOut } = useAuth();

  const [filter, setFilter] = useState<Filter>("all");
  const [entryOpen, setEntryOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [entryDone, setEntryDone] = useState("");
  const [leads, setLeads] = useState(() => listLeadsForOwner(user?.employeeId ?? ""));

  if (!user) return null;
  const currentUser = user;

  function refreshLeads() {
    setLeads(listLeadsForOwner(currentUser.employeeId));
  }

  const shown =
    filter === "all"
      ? leads
      : filter === "open"
        ? leads.filter((l) => l.status === "waiting" || l.status === "trying")
        : leads.filter((l) => l.status === filter);

  const stats = [
    { value: leads.length, label: "Added by you today", color: "#16232A" },
    { value: leads.filter((l) => l.status === "booked").length, label: "Booked", color: "var(--success)" },
    { value: leads.filter((l) => l.status === "waiting" || l.status === "trying").length, label: "Still being called", color: "var(--primary)" },
    { value: leads.filter((l) => l.urgent).length, label: "Marked urgent", color: "var(--danger)" },
    { value: leads.filter((l) => l.merged).length, label: "Duplicates caught", color: "var(--warning)" },
  ];

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <img src="/assets/umch-logo.png" alt="United Healthcare" />
        <span className={styles.headerTitle}>Lead intake</span>
        <div className={styles.headerUser}>
          <span className={styles.headerAvatar}>{initials(user.name)}</span>
          <div>
            <div className={styles.headerName}>{user.name}</div>
            <div className={styles.headerMeta}>
              {user.employeeId} · {user.roleLabel}
              <button type="button" className={styles.headerSignOut} onClick={signOut}>
                Sign out
              </button>
            </div>
          </div>
        </div>
      </header>

      <div className={styles.main}>
        <div className={styles.titleRow}>
          <div className={styles.titleBlock}>
            <h1 className={styles.title}>Your leads today</h1>
            <div className={styles.titleSub}>The call centre works these in arrival order. You see what happened, not the calling itself.</div>
          </div>
          <div className={styles.actions}>
            <button type="button" className={styles.btnImport} onClick={() => setImportOpen(true)}>
              Import a file
            </button>
            <button
              type="button"
              className={styles.btnAdd}
              onClick={() => {
                setEntryDone("");
                setEntryOpen(true);
              }}
            >
              Add a lead
            </button>
          </div>
        </div>

        <div className={styles.statGrid}>
          {stats.map((st) => (
            <div key={st.label} className={styles.statCard}>
              <div className={styles.statValue} style={{ color: st.color }}>
                {st.value}
              </div>
              <div className={styles.statLabel}>{st.label}</div>
            </div>
          ))}
        </div>

        {entryDone && <div className={styles.entryDoneBanner}>{entryDone}</div>}

        <div className={styles.listCard}>
          <div className={styles.listHeader}>
            <span className={styles.listHeaderTitle}>Submitted by you</span>
            <div className={styles.filterRow}>
              {FILTERS.map((f) => {
                const on = filter === f.key;
                return (
                  <button
                    key={f.key}
                    type="button"
                    className={styles.filterPill}
                    style={{
                      background: on ? "var(--primary)" : "var(--surface)",
                      color: on ? "#fff" : "var(--ink-muted)",
                      border: `1px solid ${on ? "var(--primary)" : "var(--border-input)"}`,
                    }}
                    onClick={() => setFilter(f.key)}
                  >
                    {f.label}
                  </button>
                );
              })}
            </div>
          </div>

          {shown.map((lead) => {
            const st = STATUS_STYLE[lead.status];
            return (
              <div key={lead.id} className={styles.row}>
                <div className={styles.rowLeft}>
                  <div className={styles.rowNameLine}>
                    <span className={styles.rowName}>{lead.name}</span>
                    {lead.urgent && <span className={`${styles.badge} ${styles.badgeUrgent}`}>URGENT</span>}
                    {lead.cohort && <span className={`${styles.badge} ${styles.badgeCohort}`}>{lead.cohort}</span>}
                    {lead.merged && <span className={`${styles.badge} ${styles.badgeMerged}`}>MERGED</span>}
                  </div>
                  <div className={styles.rowPhone}>{lead.phone}</div>
                  <div className={styles.rowService}>
                    {serviceLine(lead)} · {lead.facility}
                  </div>
                </div>
                <div className={styles.rowRight}>
                  <div className={styles.statusPill} style={{ background: st.bg, borderColor: st.border }}>
                    <span className={styles.statusDot} style={{ background: st.dot }} />
                    <span className={styles.statusText} style={{ color: st.fg }}>
                      {st.label}
                    </span>
                  </div>
                  <div className={styles.rowDetail}>{lead.detail}</div>
                </div>
              </div>
            );
          })}
          {shown.length === 0 && <div className={styles.emptyState}>Nothing here yet with that filter.</div>}
        </div>

        <div className={styles.footerNote}>Booking and payment live in the ERP. This list shows the call outcome only.</div>
      </div>

      {entryOpen && (
        <AddLeadModal
          currentUser={user}
          onClose={() => setEntryOpen(false)}
          onSaved={(message) => {
            setEntryDone(message);
            refreshLeads();
          }}
        />
      )}

      {importOpen && (
        <ImportModal
          currentUser={user}
          onClose={() => setImportOpen(false)}
          onImported={() => refreshLeads()}
        />
      )}
    </div>
  );
}
