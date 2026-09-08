import { useState } from "react";
import styles from "./Users.module.css";
import { useAuth } from "../../context/AuthContext";
import {
  listAccounts,
  isValidEmployeeId,
  findAccount,
  createAccount,
  resetPassword,
  setAccountActive,
  generatePassword,
} from "../../api/auth";
import type { Role } from "../../api/types";

const ROLE_META: Record<Role, { tag: string; label: string; desc: string; bg: string; fg: string }> = {
  requester: { tag: "REQUESTER", label: "Adds leads", desc: "Business development, marketing, front desk. Submits leads and sees their outcome.", bg: "#E7F1F2", fg: "#0A5C64" },
  agent: { tag: "AGENT", label: "Calls leads", desc: "Call centre. Works the queue and logs what happened on each call.", bg: "#EDEBF6", fg: "#4A3E8F" },
  admin: { tag: "ADMIN", label: "Runs the queue", desc: "Sees every lead, reassigns work, pulls reports. Cannot change passwords.", bg: "#FDF9EE", fg: "#7A4E06" },
  superadmin: { tag: "SUPERADMIN", label: "Manages people", desc: "Everything an admin can do, plus creating accounts and resetting passwords.", bg: "#E9F6F1", fg: "#125C3D" },
};

const HOSPITALS = ["UMCH Main", "Medix Uttara", "MA Rashid Clinic", "All sites"];

type Filter = "all" | "staff" | "admins" | "off";

export function Users() {
  const { user, signOut } = useAuth();
  const [filter, setFilter] = useState<Filter>("all");
  const [flash, setFlash] = useState("");
  const [accounts, setAccounts] = useState(() => listAccounts());

  const [addOpen, setAddOpen] = useState(false);
  const [nfId, setNfId] = useState("");
  const [nfName, setNfName] = useState("");
  const [nfRole, setNfRole] = useState<Role | "">("");
  const [nfFacility, setNfFacility] = useState("");
  const [nfExt, setNfExt] = useState("");
  const [nfPassword, setNfPassword] = useState("");

  const [resetTarget, setResetTarget] = useState<string | null>(null);
  const [resetStage, setResetStage] = useState<"confirm" | "done">("confirm");
  const [resetShownPassword, setResetShownPassword] = useState("");

  if (!user) return null;
  const currentUser = user;
  const canManage = currentUser.role === "superadmin";
  const initials = currentUser.name.split(" ").map((w) => w[0]).join("").slice(0, 2);

  function refresh() {
    setAccounts(listAccounts());
  }

  const idTaken = nfId.trim() ? !!findAccount(nfId) : false;
  const idOk = isValidEmployeeId(nfId);
  const blockers: string[] = [];
  if (!nfId.trim()) blockers.push("Write their employee ID.");
  else if (!idOk) blockers.push("Employee ID looks like BD-014 — two letters, a dash, three digits.");
  else if (idTaken) blockers.push("That employee ID already has an account.");
  else if (!nfName.trim()) blockers.push("Write their full name.");
  else if (!nfRole) blockers.push("Pick what they do.");
  else if (!nfFacility) blockers.push("Choose which hospital.");
  else if (nfRole === "agent" && !nfExt.trim()) blockers.push("Agents need the number they call from — the monthly call file is matched on it.");

  const shown = accounts.filter((a) => {
    if (filter === "all") return true;
    if (filter === "off") return !a.active;
    if (!a.active) return false;
    return filter === "staff" ? a.role === "requester" || a.role === "agent" : a.role === "admin" || a.role === "superadmin";
  });

  const resetAccount = resetTarget ? findAccount(resetTarget) : null;

  function openAdd() {
    setNfId("");
    setNfName("");
    setNfRole("");
    setNfFacility("");
    setNfExt("");
    setNfPassword(generatePassword());
    setFlash("");
    setAddOpen(true);
  }

  function handleCreate() {
    if (blockers.length || !nfRole) return;
    const { account, password } = createAccount({ employeeId: nfId, name: nfName, role: nfRole, facility: nfFacility, callingNumber: nfExt });
    setAddOpen(false);
    setFlash(`${account.name} (${account.employeeId}) can sign in — password ${password}. Write it down now.`);
    refresh();
  }

  function openReset(id: string) {
    setResetTarget(id);
    setResetStage("confirm");
    setResetShownPassword("");
  }

  function confirmReset() {
    if (!resetTarget) return;
    const password = resetPassword(resetTarget);
    setResetShownPassword(password);
    setResetStage("done");
    refresh();
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <img src="/assets/umch-logo.png" alt="United Healthcare" />
        <span className={styles.headerTitle}>People &amp; access</span>
        <div className={styles.headerUser}>
          <span className={styles.avatar}>{initials}</span>
          <div>
            <div className={styles.headerName}>{currentUser.name}</div>
            <div className={styles.headerMeta}>
              {currentUser.employeeId} · {currentUser.roleLabel}
              <button type="button" className={styles.signOutBtn} onClick={signOut}>
                Sign out
              </button>
            </div>
          </div>
        </div>
      </header>

      <div className={styles.main}>
        <div className={styles.titleRow}>
          <div>
            <h1 className={styles.title}>Who can sign in</h1>
            <div className={styles.subhead}>
              {canManage
                ? "Create accounts, set what someone can do, and reset a password when they lose it."
                : "Everyone with access to the queue. Only a superadmin can add people or reset passwords."}
            </div>
          </div>
          {canManage && (
            <button type="button" className={styles.addBtn} onClick={openAdd}>
              Add a person
            </button>
          )}
        </div>

        {flash && <div className={styles.flash}>{flash}</div>}

        <div className={styles.statGrid}>
          <div className={styles.statCard}>
            <div className={styles.statValue}>{accounts.filter((a) => a.active).length}</div>
            <div className={styles.statLabel}>Active accounts</div>
          </div>
          <div className={styles.statCard}>
            <div className={styles.statValue} style={{ color: "var(--primary)" }}>{accounts.filter((a) => a.role === "agent" && a.active).length}</div>
            <div className={styles.statLabel}>Call centre agents</div>
          </div>
          <div className={styles.statCard}>
            <div className={styles.statValue} style={{ color: "var(--warning)" }}>{accounts.filter((a) => a.mustChangePassword).length}</div>
            <div className={styles.statLabel}>Never signed in</div>
          </div>
          <div className={styles.statCard}>
            <div className={styles.statValue} style={{ color: "var(--danger)" }}>
              {accounts.filter((a) => a.role === "agent" && a.active && !a.callingNumber).length}
            </div>
            <div className={styles.statLabel}>Agents with no calling number</div>
          </div>
          <div className={styles.statCard}>
            <div className={styles.statValue} style={{ color: "var(--danger)" }}>{accounts.filter((a) => !a.active).length}</div>
            <div className={styles.statLabel}>Access removed</div>
          </div>
        </div>

        <div className={styles.listCard}>
          <div className={styles.listHead}>
            <span className={styles.listHeadTitle}>Accounts</span>
            <div className={styles.filterRow}>
              {([
                { k: "all", label: "Everyone" },
                { k: "staff", label: "Requesters & agents" },
                { k: "admins", label: "Admins" },
                { k: "off", label: "No access" },
              ] as { k: Filter; label: string }[]).map((f) => (
                <button
                  key={f.k}
                  type="button"
                  className={styles.filterPill}
                  style={filter === f.k ? { background: "var(--primary)", color: "#fff", borderColor: "var(--primary)" } : undefined}
                  onClick={() => setFilter(f.k)}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {shown.map((a) => {
            const r = ROLE_META[a.role];
            const meta = `${r.label} · ${a.facility}${a.callingNumber ? " · calls from " + a.callingNumber : a.role === "agent" ? " · no calling number set" : ""}`;
            return (
              <div key={a.employeeId} className={styles.row} style={{ opacity: a.active ? 1 : 0.6 }}>
                <div className={styles.rowLeft}>
                  <div className={styles.nameRow}>
                    <span className={styles.name}>{a.name}</span>
                    <span className={styles.roleTag} style={{ background: r.bg, color: r.fg }}>{r.tag}</span>
                    {!a.active && <span className={styles.noAccessTag}>NO ACCESS</span>}
                  </div>
                  <div className={styles.idText}>{a.employeeId}</div>
                  <div className={styles.metaText}>{meta}</div>
                </div>
                <div className={styles.rowActions}>
                  {a.mustChangePassword && <span className={styles.mustSetPill}>Has not signed in yet</span>}
                  {canManage && (
                    <>
                      <button type="button" className={styles.actionBtn} onClick={() => openReset(a.employeeId)}>
                        Reset password
                      </button>
                      <button
                        type="button"
                        className={styles.actionBtn}
                        style={a.active ? { color: "var(--danger)", borderColor: "var(--danger-tint-border)" } : { color: "var(--primary-dark)", borderColor: "var(--primary-tint-border)" }}
                        onClick={() => {
                          setAccountActive(a.employeeId, !a.active);
                          setFlash(a.active ? `${a.name} can no longer sign in. Their logged calls stay on record.` : `${a.name} can sign in again.`);
                          refresh();
                        }}
                      >
                        {a.active ? "Remove access" : "Restore access"}
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
          {shown.length === 0 && <div className={styles.emptyRow}>Nobody here with that filter.</div>}
        </div>

        {!canManage && (
          <div className={styles.readOnlyNote}>You can see the list but not change it. Passwords, roles and access are handled by a superadmin.</div>
        )}
        <div className={styles.footNote}>Passwords are generated here and shown once. Nobody — including a superadmin — can read an existing password back.</div>
      </div>

      {addOpen && (
        <div className={styles.overlay}>
          <div className={styles.modal}>
            <div className={styles.modalHead}>
              <div>
                <div className={styles.modalTitle}>Add a person</div>
                <div className={styles.modalSub}>They sign in with the employee ID and the password below.</div>
              </div>
              <button type="button" className={styles.modalClose} onClick={() => setAddOpen(false)}>×</button>
            </div>
            <div className={styles.modalBody}>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Employee ID</span>
                <input
                  value={nfId}
                  onChange={(e) => setNfId(e.target.value)}
                  placeholder="BD-014"
                  className={styles.idInput}
                  style={{ borderWidth: 1.5, borderStyle: "solid", borderColor: !nfId.trim() ? "var(--border-input)" : idOk && !idTaken ? "var(--success-tint-border)" : "#E0C98F" }}
                />
                <span className={styles.hint} style={{ color: !nfId.trim() ? "var(--ink-faint)" : idOk && !idTaken ? "var(--success-dark)" : "var(--warning-dark)" }}>
                  {!nfId.trim() ? "This is what they type to sign in." : idTaken ? "Already taken — check the roster." : idOk ? "Available." : "Two letters, a dash, three digits."}
                </span>
              </label>

              <label className={styles.field}>
                <span className={styles.fieldLabel}>Full name</span>
                <input value={nfName} onChange={(e) => setNfName(e.target.value)} placeholder="As it appears on the roster" className={styles.textInput} />
              </label>

              <div>
                <span className={styles.fieldLabel}>What they do</span>
                <div className={styles.roleGrid}>
                  {(Object.keys(ROLE_META) as Role[]).map((k) => {
                    const on = nfRole === k;
                    const r = ROLE_META[k];
                    return (
                      <button
                        key={k}
                        type="button"
                        className={styles.roleCard}
                        style={on ? { background: "var(--primary-tint)", borderColor: "var(--primary)" } : undefined}
                        onClick={() => setNfRole(k)}
                      >
                        <div className={styles.roleCardTitle} style={{ color: on ? "var(--primary-dark)" : "var(--ink)" }}>{r.label}</div>
                        <div className={styles.roleCardDesc} style={{ color: on ? "#3F6A70" : "var(--ink-faint)" }}>{r.desc}</div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <label className={styles.field}>
                <span className={styles.fieldLabel}>Which hospital</span>
                <select value={nfFacility} onChange={(e) => setNfFacility(e.target.value)} className={styles.textInput} style={{ maxWidth: 300 }}>
                  <option value="">Choose one…</option>
                  {HOSPITALS.map((h) => (
                    <option key={h} value={h}>{h}</option>
                  ))}
                </select>
              </label>

              <label className={styles.field}>
                <span className={styles.fieldLabel}>
                  The number they call from <span style={{ fontWeight: 500, color: "var(--ink-faint)" }}>— {nfRole === "agent" ? "required for agents" : "optional"}</span>
                </span>
                <input
                  value={nfExt}
                  onChange={(e) => setNfExt(e.target.value)}
                  placeholder={nfRole === "agent" ? "2107" : "extension or mobile"}
                  className={styles.textInput}
                  style={{ maxWidth: 260, fontFamily: "var(--font-mono)", fontSize: 16 }}
                />
                <span className={styles.hint} style={{ color: "var(--ink-faint)" }}>
                  {nfRole === "agent"
                    ? "Desk extension, or their mobile if they dial from their own phone. The monthly call file has no names in it — this is what ties a call to this person."
                    : "Only needed for people who place calls."}
                </span>
              </label>

              <div className={styles.pwBox}>
                <div className={styles.pwBoxTitle}>First password</div>
                <div className={styles.pwRow}>
                  <span className={styles.pwValue}>{nfPassword}</span>
                  <button type="button" className={styles.regenBtn} onClick={() => setNfPassword(generatePassword())}>
                    Generate another
                  </button>
                </div>
                <div className={styles.pwNote}>Give it to them directly. They are asked to change it the first time they sign in, and this screen will not show it again.</div>
              </div>
            </div>
            <div className={styles.modalFooter}>
              <button
                type="button"
                disabled={blockers.length > 0}
                className={styles.saveBtn}
                style={{ background: blockers.length ? "var(--disabled-btn)" : "var(--primary)", opacity: blockers.length ? 0.75 : 1 }}
                onClick={handleCreate}
              >
                Create account
              </button>
              <div className={styles.footerStatus} style={{ color: blockers.length ? "var(--danger)" : "var(--ink-faint)" }}>
                {blockers.length ? blockers[0] : "They can sign in straight away with this password."}
              </div>
            </div>
          </div>
        </div>
      )}

      {resetAccount && (
        <div className={`${styles.overlay} ${styles.overlayCenter}`}>
          <div className={`${styles.modal} ${styles.modalNarrow}`}>
            <div className={styles.resetTitle}>
              {resetStage === "done" ? `Password reset for ${resetAccount.name}` : `Reset ${resetAccount.name}'s password?`}
            </div>
            <div className={styles.resetBody}>
              {resetStage === "done"
                ? "Read it out to them. They will be asked to change it when they sign in."
                : `Their current password stops working immediately and a new one is generated. Logged against ${currentUser.employeeId}.`}
            </div>
            {resetStage === "done" && (
              <div className={styles.pwBox} style={{ marginTop: 16 }}>
                <div style={{ fontSize: 13, color: "var(--ink-muted)" }}>New password</div>
                <div className={styles.pwValue} style={{ marginTop: 6 }}>{resetShownPassword}</div>
                <div className={styles.pwNote}>Shown once. Their old password stopped working just now.</div>
              </div>
            )}
            <div className={styles.resetActions}>
              <button type="button" className={styles.cancelBtn} onClick={() => setResetTarget(null)}>
                {resetStage === "done" ? "Done" : "Cancel"}
              </button>
              {resetStage === "confirm" && (
                <button type="button" className={styles.confirmBtn} onClick={confirmReset}>
                  Reset it
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
