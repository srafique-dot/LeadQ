import { useEffect, useState } from "react";
import styles from "./Users.module.css";
import { useAuth } from "../../context/AuthContext";
import {
  findAccountIn,
  resetPassword,
  setAccountActive,
  renameAccount,
  createInvite,
  listInvites,
} from "../../api/auth";
import { listChannels, createChannel, setChannelActive } from "../../api/channels";
import { getSettings, setSetting, type SmsTemplateKey } from "../../api/settings";
import type { Channel, Invite, Role } from "../../api/types";

const SMS_TEMPLATES: { key: SmsTemplateKey; label: string; hint: string; tokens: string }[] = [
  { key: "sms_missed_call", label: "Missed-call SMS", hint: "Sent after 3 unanswered attempts.", tokens: "{name}" },
  { key: "sms_callback_confirm", label: "Callback confirmation", hint: "Sent when a callback date is logged.", tokens: "{name}, {date}" },
  { key: "sms_booking_confirm", label: "Booking confirmation", hint: "Sent when an appointment is booked or purchased.", tokens: "{name}, {date}, {time}, {doctor}, {facility}" },
];

const ROLE_META: Record<Role, { tag: string; label: string; desc: string; bg: string; fg: string }> = {
  requester: { tag: "REQUESTER", label: "Adds leads", desc: "Business development, marketing, front desk. Submits leads and sees their outcome.", bg: "#E7F1F2", fg: "#0A5C64" },
  agent: { tag: "AGENT", label: "Calls leads", desc: "Call centre. Works the queue and logs what happened on each call.", bg: "#EDEBF6", fg: "#4A3E8F" },
  admin: { tag: "ADMIN", label: "Runs the queue", desc: "Sees every lead, reassigns work, pulls reports. Cannot change passwords.", bg: "#FDF9EE", fg: "#7A4E06" },
  superadmin: { tag: "SUPERADMIN", label: "Manages people", desc: "Everything an admin can do, plus creating accounts and resetting passwords.", bg: "#E9F6F1", fg: "#125C3D" },
};

type Filter = "all" | "staff" | "admins" | "off";

export function Users() {
  const { user, accounts, refresh: refreshAuth, refreshAccounts, signOut } = useAuth();
  const [filter, setFilter] = useState<Filter>("all");
  const [flash, setFlash] = useState("");

  const [inviteOpen, setInviteOpen] = useState(false);
  const [niRole, setNiRole] = useState<Role | "">("");
  const [createdInvite, setCreatedInvite] = useState<Invite | null>(null);
  const [invites, setInvites] = useState<Invite[]>([]);

  const [resetTarget, setResetTarget] = useState<string | null>(null);
  const [resetStage, setResetStage] = useState<"confirm" | "done">("confirm");
  const [resetShownPassword, setResetShownPassword] = useState("");

  const [renameTarget, setRenameTarget] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const [channels, setChannels] = useState<Channel[]>([]);
  const [newChannel, setNewChannel] = useState("");

  const [smsTemplates, setSmsTemplates] = useState<Record<string, string>>({});
  const [smsDrafts, setSmsDrafts] = useState<Record<string, string>>({});
  const [smsSavedKey, setSmsSavedKey] = useState("");

  function refreshInvites() {
    listInvites().then(setInvites);
  }

  function refreshChannels() {
    listChannels().then(setChannels);
  }

  function refreshSmsTemplates() {
    getSettings().then((s) => {
      setSmsTemplates(s);
      setSmsDrafts(s);
    });
  }

  useEffect(() => {
    if (user?.role === "superadmin") {
      refreshInvites();
      refreshChannels();
      refreshSmsTemplates();
    }
  }, [user?.employeeId]);

  async function handleAddChannel() {
    if (!newChannel.trim() || !user) return;
    await createChannel(newChannel.trim(), user.employeeId);
    setNewChannel("");
    refreshChannels();
  }

  async function handleSaveTemplate(key: SmsTemplateKey) {
    if (!user) return;
    await setSetting(key, smsDrafts[key] ?? "", user.employeeId);
    setSmsTemplates((t) => ({ ...t, [key]: smsDrafts[key] ?? "" }));
    setSmsSavedKey(key);
    setTimeout(() => setSmsSavedKey(""), 2000);
  }

  if (!user) return null;
  const currentUser = user;
  const canManage = currentUser.role === "superadmin";
  const initials = currentUser.name.split(" ").map((w) => w[0]).join("").slice(0, 2);

  const blockers: string[] = [];
  if (!niRole) blockers.push("Pick what they do.");

  const shown = accounts.filter((a) => {
    if (filter === "all") return true;
    if (filter === "off") return !a.active;
    if (!a.active) return false;
    return filter === "staff" ? a.role === "requester" || a.role === "agent" : a.role === "admin" || a.role === "superadmin";
  });

  const resetAccount = resetTarget ? findAccountIn(accounts, resetTarget) : null;
  const renameTargetAccount = renameTarget ? findAccountIn(accounts, renameTarget) : null;

  function openInvite() {
    setNiRole("");
    setCreatedInvite(null);
    setFlash("");
    setInviteOpen(true);
  }

  async function handleCreateInvite() {
    if (blockers.length || !niRole) return;
    try {
      const invite = await createInvite({ role: niRole, facility: "", callingNumber: "" });
      setCreatedInvite(invite);
      refreshInvites();
    } catch (err) {
      setFlash(err instanceof Error ? err.message : "Could not create the invite.");
    }
  }

  function openReset(id: string) {
    setResetTarget(id);
    setResetStage("confirm");
    setResetShownPassword("");
  }

  async function confirmReset() {
    if (!resetTarget) return;
    const password = await resetPassword(resetTarget);
    setResetShownPassword(password);
    setResetStage("done");
    await refreshAccounts();
  }

  function openRename(id: string) {
    const account = findAccountIn(accounts, id);
    setRenameTarget(id);
    setRenameValue(account?.name ?? "");
  }

  async function confirmRename() {
    if (!renameTarget || !renameValue.trim()) return;
    await renameAccount(renameTarget, renameValue);
    setRenameTarget(null);
    await refreshAccounts();
    await refreshAuth();
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
            <button type="button" className={styles.addBtn} onClick={openInvite}>
              Invite a person
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
                      <button type="button" className={styles.actionBtn} onClick={() => openRename(a.employeeId)}>
                        Edit name
                      </button>
                      <button type="button" className={styles.actionBtn} onClick={() => openReset(a.employeeId)}>
                        Reset password
                      </button>
                      <button
                        type="button"
                        className={styles.actionBtn}
                        style={a.active ? { color: "var(--danger)", borderColor: "var(--danger-tint-border)" } : { color: "var(--primary-dark)", borderColor: "var(--primary-tint-border)" }}
                        onClick={async () => {
                          await setAccountActive(a.employeeId, !a.active);
                          setFlash(a.active ? `${a.name} can no longer sign in. Their logged calls stay on record.` : `${a.name} can sign in again.`);
                          await refreshAccounts();
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
        <div className={styles.footNote}>Everyone sets their own password when they claim their invite. Nobody — including a superadmin — can read an existing password back.</div>

        {canManage && invites.length > 0 && (
          <div className={styles.listCard} style={{ marginTop: 16 }}>
            <div className={styles.listHead}>
              <span className={styles.listHeadTitle}>Invites</span>
            </div>
            {invites.map((i) => (
              <div key={i.token} className={styles.row}>
                <div className={styles.rowLeft}>
                  <div className={styles.nameRow}>
                    <span className={styles.name}>{i.roleLabel}</span>
                    {!i.usedAt && <span className={styles.roleTag} style={{ background: "#FDF9EE", color: "#7A4E06" }}>PENDING</span>}
                  </div>
                  <div className={styles.metaText}>
                    {i.facility || "Any hospital"} · {i.usedAt ? `Claimed by ${i.usedByName}` : "Not claimed yet"}
                  </div>
                </div>
                {!i.usedAt && (
                  <div className={styles.rowActions}>
                    <button
                      type="button"
                      className={styles.actionBtn}
                      onClick={() => navigator.clipboard?.writeText(`${window.location.origin}/?invite=${i.token}`)}
                    >
                      Copy link
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {canManage && (
          <div className={styles.listCard} style={{ marginTop: 16 }}>
            <div className={styles.listHead}>
              <span className={styles.listHeadTitle}>Lead sources</span>
            </div>
            <div style={{ display: "flex", gap: 9, padding: "14px 20px", borderBottom: "1px solid var(--border-light)" }}>
              <input
                value={newChannel}
                onChange={(e) => setNewChannel(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newChannel.trim()) handleAddChannel();
                }}
                placeholder="e.g. Facebook Ads"
                className={styles.textInput}
                style={{ maxWidth: 280 }}
              />
              <button type="button" className={styles.actionBtn} disabled={!newChannel.trim()} onClick={handleAddChannel}>
                Add source
              </button>
            </div>
            {channels.map((c) => (
              <div key={c.name} className={styles.row} style={{ opacity: c.active ? 1 : 0.6 }}>
                <div className={styles.rowLeft}>
                  <div className={styles.nameRow}>
                    <span className={styles.name}>{c.name}</span>
                    {!c.active && <span className={styles.noAccessTag}>HIDDEN</span>}
                  </div>
                </div>
                <div className={styles.rowActions}>
                  <button
                    type="button"
                    className={styles.actionBtn}
                    style={c.active ? { color: "var(--danger)", borderColor: "var(--danger-tint-border)" } : { color: "var(--primary-dark)", borderColor: "var(--primary-tint-border)" }}
                    onClick={async () => {
                      await setChannelActive(c.name, !c.active);
                      refreshChannels();
                    }}
                  >
                    {c.active ? "Hide from form" : "Show on form"}
                  </button>
                </div>
              </div>
            ))}
            {channels.length === 0 && <div className={styles.emptyRow}>No lead sources yet.</div>}
          </div>
        )}

        {canManage && (
          <div className={styles.listCard} style={{ marginTop: 16 }}>
            <div className={styles.listHead}>
              <span className={styles.listHeadTitle}>SMS templates</span>
            </div>
            <div style={{ padding: "0 20px 4px", fontSize: 13, color: "var(--ink-faint)", lineHeight: 1.6 }}>
              There's no SMS gateway — agents copy this text and send it from their own phone at the point each one applies. Anything in{" "}
              {"{braces}"} gets filled in from the lead automatically.
            </div>
            {SMS_TEMPLATES.map((t) => {
              const dirty = smsDrafts[t.key] !== smsTemplates[t.key];
              return (
                <div key={t.key} style={{ padding: "14px 20px", borderTop: "1px solid var(--border-light)" }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
                    <span style={{ fontWeight: 600, fontSize: 14 }}>{t.label}</span>
                    <span style={{ fontSize: 12.5, color: "var(--ink-faint)" }}>{t.hint} Tokens: {t.tokens}</span>
                  </div>
                  <textarea
                    value={smsDrafts[t.key] ?? ""}
                    onChange={(e) => setSmsDrafts((d) => ({ ...d, [t.key]: e.target.value }))}
                    rows={2}
                    className={styles.textInput}
                    style={{ width: "100%", resize: "vertical", fontFamily: "inherit" }}
                  />
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6 }}>
                    <button
                      type="button"
                      className={styles.actionBtn}
                      disabled={!dirty}
                      style={{ opacity: dirty ? 1 : 0.5 }}
                      onClick={() => handleSaveTemplate(t.key)}
                    >
                      Save
                    </button>
                    {smsSavedKey === t.key && <span style={{ fontSize: 12.5, color: "var(--success)" }}>Saved</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {inviteOpen && (
        <div className={styles.overlay}>
          <div className={styles.modal}>
            <div className={styles.modalHead}>
              <div>
                <div className={styles.modalTitle}>Invite a person</div>
                <div className={styles.modalSub}>
                  {createdInvite
                    ? "Share this link with them — they'll fill in their own name, ID and password."
                    : "Pick what they can do. They'll fill in their own name, employee ID and password when they open the link."}
                </div>
              </div>
              <button type="button" className={styles.modalClose} onClick={() => setInviteOpen(false)}>×</button>
            </div>

            {createdInvite ? (
              <>
                <div className={styles.modalBody}>
                  <div className={styles.pwBox}>
                    <div className={styles.pwBoxTitle}>Invite link</div>
                    <div className={styles.pwRow}>
                      <span className={styles.pwValue} style={{ fontSize: 13, wordBreak: "break-all" }}>
                        {window.location.origin}/?invite={createdInvite.token}
                      </span>
                      <button
                        type="button"
                        className={styles.regenBtn}
                        onClick={() => navigator.clipboard?.writeText(`${window.location.origin}/?invite=${createdInvite.token}`)}
                      >
                        Copy
                      </button>
                    </div>
                    <div className={styles.pwNote}>
                      {createdInvite.roleLabel}
                      {createdInvite.facility ? ` · ${createdInvite.facility}` : ""}. Works once — send it to one person.
                    </div>
                  </div>
                </div>
                <div className={styles.modalFooter}>
                  <button type="button" className={styles.saveBtn} onClick={() => setInviteOpen(false)}>
                    Done
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className={styles.modalBody}>
                  <div>
                    <span className={styles.fieldLabel}>What they do</span>
                    <div className={styles.roleGrid}>
                      {(Object.keys(ROLE_META) as Role[]).map((k) => {
                        const on = niRole === k;
                        const r = ROLE_META[k];
                        return (
                          <button
                            key={k}
                            type="button"
                            className={styles.roleCard}
                            style={on ? { background: "var(--primary-tint)", borderColor: "var(--primary)" } : undefined}
                            onClick={() => setNiRole(k)}
                          >
                            <div className={styles.roleCardTitle} style={{ color: on ? "var(--primary-dark)" : "var(--ink)" }}>{r.label}</div>
                            <div className={styles.roleCardDesc} style={{ color: on ? "#3F6A70" : "var(--ink-faint)" }}>{r.desc}</div>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                </div>
                <div className={styles.modalFooter}>
                  <button
                    type="button"
                    disabled={blockers.length > 0}
                    className={styles.saveBtn}
                    style={{ background: blockers.length ? "var(--disabled-btn)" : "var(--primary)", opacity: blockers.length ? 0.75 : 1 }}
                    onClick={handleCreateInvite}
                  >
                    Create invite link
                  </button>
                  <div className={styles.footerStatus} style={{ color: blockers.length ? "var(--danger)" : "var(--ink-faint)" }}>
                    {blockers.length ? blockers[0] : "You'll get a link to share with them."}
                  </div>
                </div>
              </>
            )}
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

      {renameTargetAccount && (
        <div className={`${styles.overlay} ${styles.overlayCenter}`}>
          <div className={`${styles.modal} ${styles.modalNarrow}`}>
            <div className={styles.resetTitle}>Rename {renameTargetAccount.name}</div>
            <div className={styles.resetBody}>
              Their employee ID ({renameTargetAccount.employeeId}) stays the same — this only changes the name shown
              on the roster.
            </div>
            <input
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && renameValue.trim()) confirmRename();
              }}
              placeholder="As it appears on the roster"
              className={styles.textInput}
              style={{ marginTop: 16 }}
              autoFocus
            />
            <div className={styles.resetActions}>
              <button type="button" className={styles.cancelBtn} onClick={() => setRenameTarget(null)}>
                Cancel
              </button>
              <button type="button" className={styles.confirmBtn} disabled={!renameValue.trim()} onClick={confirmRename}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
