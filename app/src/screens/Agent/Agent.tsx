import { useEffect, useMemo, useRef, useState } from "react";
import styles from "./Agent.module.css";
import { useAuth } from "../../context/AuthContext";
import {
  getAgentQueue,
  saveDisposition,
  escalateLead,
  splitMergedLead,
  serviceLine,
  leadTypeLabel,
  getCohortInstructions,
  claimLead,
  releaseLead,
  LeadClaimedError,
  LEVEL1,
  LEVEL2,
  QUICK_NOTES,
  FAILED,
  MAX_ATTEMPTS,
} from "../../api/leads";
import { setPresence } from "../../api/auth";
import { getSettings, fillTemplate } from "../../api/settings";
import type { Lead, Level1Code, Level2Code, Presence } from "../../api/types";
import { cohortColor } from "../../lib/cohortColor";
import { AddLeadModal } from "../Requester/components/AddLeadModal";
import { SearchModal } from "./components/SearchModal";
import { EscalateModal } from "./components/EscalateModal";

function pad(n: number): string {
  return n < 10 ? "0" + n : String(n);
}

function ageMinutes(lead: Lead, now: number): number {
  return Math.max(0, Math.floor((now - Date.parse(lead.createdAt)) / 60000));
}

function ageLabel(m: number): string {
  return m < 60 ? m + "m" : m < 1440 ? Math.floor(m / 60) + "h" : Math.floor(m / 1440) + "d";
}

function slaColor(m: number): string {
  return m <= 5 ? "#1B7A4B" : m <= 20 ? "#9A6206" : "#B4362A";
}

/** No SMS gateway exists — this generates the text and lets the agent copy
 * it into their own phone's SMS app. Shared across the three trigger points
 * (missed-call, callback confirmation, booking confirmation) so they read
 * and behave identically; only the title/text/requiredness differ. */
function SmsCopyBox({ title, text, required, copied, onCopy }: { title: string; text: string; required?: boolean; copied: boolean; onCopy: () => void }) {
  const flagged = !!required && !copied;
  return (
    <div className={styles.smsBox} style={flagged ? { background: "var(--danger-tint)", borderColor: "var(--danger-tint-border)" } : undefined}>
      <div className={styles.smsTitle} style={{ color: flagged ? "#7A2F26" : "var(--ink)" }}>
        {copied ? `${title} — copied` : flagged ? `${title} — copy before saving` : title}
      </div>
      <div className={styles.smsFootnote} style={{ whiteSpace: "pre-wrap" }}>{text}</div>
      <button
        type="button"
        className={styles.smsBtn}
        style={copied ? { background: "var(--success-tint)", color: "var(--success-dark)", borderColor: "var(--success-tint-border)" } : { background: "var(--primary)", color: "#fff" }}
        onClick={() => {
          try {
            navigator.clipboard?.writeText(text);
          } catch {
            /* clipboard unavailable — the text is still visible to select by hand */
          }
          onCopy();
        }}
      >
        {copied ? "Copied · paste into your SMS app" : "Copy SMS text"}
      </button>
    </div>
  );
}

function isoPlus(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function nextRunTime(): string {
  const back = new Date(Date.now() + 12 * 60000);
  return `${pad(back.getHours())}:${pad(back.getMinutes())}`;
}

export function Agent() {
  const { user, signOut } = useAuth();

  const [queue, setQueue] = useState<Lead[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [phase, setPhase] = useState<"brief" | "disposition">("brief");
  const [l1, setL1] = useState<Level1Code | null>(null);
  const [l2, setL2] = useState<Level2Code | null>(null);
  const [note, setNote] = useState("");
  const [nextActionDate, setNextActionDate] = useState("");
  const [erpRef, setErpRef] = useState("");
  const [smsCopied, setSmsCopied] = useState(false);
  const [callbackSmsCopied, setCallbackSmsCopied] = useState(false);
  const [bookingSmsCopied, setBookingSmsCopied] = useState(false);
  const [smsTemplates, setSmsTemplates] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [presence, setPresenceState] = useState<Presence>("available");
  const [claimNotice, setClaimNotice] = useState("");
  const [warnAck, setWarnAck] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [escalateOpen, setEscalateOpen] = useState(false);
  const [entryOpen, setEntryOpen] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [savedLabel, setSavedLabel] = useState("");
  const [now, setNow] = useState(Date.now());
  const [cohortNoteOpen, setCohortNoteOpen] = useState(false);
  const [cohortNoteText, setCohortNoteText] = useState<string | null>(null);
  const cohortNoteCache = useRef<Record<string, string>>({});

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    getSettings().then(setSmsTemplates);
  }, []);

  useEffect(() => {
    setCohortNoteOpen(false);
  }, [currentId]);

  async function toggleCohortNote(cohort: string) {
    if (cohortNoteOpen) {
      setCohortNoteOpen(false);
      return;
    }
    if (cohortNoteCache.current[cohort] !== undefined) {
      setCohortNoteText(cohortNoteCache.current[cohort]);
      setCohortNoteOpen(true);
      return;
    }
    const text = await getCohortInstructions(cohort);
    cohortNoteCache.current[cohort] = text;
    setCohortNoteText(text);
    setCohortNoteOpen(true);
  }

  // Signing in puts the agent on the floor; routing only hands work to
  // agents who are marked available.
  useEffect(() => {
    if (!user) return;
    setPresence(user.employeeId, "available")
      .catch(() => undefined)
      .then(() => refreshQueue());
  }, [user?.employeeId]);

  if (!user) return null;
  const currentUser = user;

  function refreshQueue() {
    getAgentQueue(currentUser.employeeId).then(setQueue);
  }

  async function changePresence(next: Presence) {
    setPresenceState(next);
    if (next !== "available" && currentId) await releaseCurrent();
    await setPresence(currentUser.employeeId, next).catch(() => undefined);
    refreshQueue();
  }

  async function releaseCurrent() {
    if (!currentId) return;
    await releaseLead(currentId, currentUser.employeeId).catch(() => undefined);
  }

  /** Selecting a lead is the same thing as starting to work it, so the claim
   * is taken here rather than behind an extra button — agents are already
   * juggling the ERP and the dialler. If someone else got there first the
   * server refuses and we say who has it. */
  async function openLead(id: string) {
    if (id === currentId) return;
    const previous = currentId;
    try {
      await claimLead(id, currentUser.employeeId);
    } catch (err) {
      if (err instanceof LeadClaimedError) {
        setClaimNotice(`${err.holderName} is already on that lead — picking it back up isn't possible until they finish.`);
        refreshQueue();
        return;
      }
      throw err;
    }
    if (previous) await releaseLead(previous, currentUser.employeeId).catch(() => undefined);
    setClaimNotice("");
    setCurrentId(id);
    resetDispositionState();
  }

  async function handleSignOut() {
    await releaseCurrent();
    await setPresence(currentUser.employeeId, "off").catch(() => undefined);
    signOut();
  }

  function resetDispositionState() {
    setPhase("brief");
    setL1(null);
    setL2(null);
    setNote("");
    setNextActionDate("");
    setErpRef("");
    setSmsCopied(false);
    setCallbackSmsCopied(false);
    setBookingSmsCopied(false);
    setDetailsOpen(false);
  }

  const lead = currentId ? (queue.find((l) => l.id === currentId) ?? queue[0]) : queue[0];

  const clockDate = new Date(now);
  const hours = clockDate.getHours();
  const outOfWindow = hours < 10 || hours >= 23;
  const fresh = queue.filter((l) => ageMinutes(l, now) < 60);
  const due = queue.filter((l) => ageMinutes(l, now) >= 60);

  const smsRequired = !!lead && lead.attempt >= 3 && !!l1 && FAILED.includes(l1);
  const isFailedPick = !!l1 && FAILED.includes(l1);
  const showAppt = l1 === "connected" && (l2 === "appointment_purchased" || l2 === "appointment_booked");
  const showNextAction = l2 === "callback_later";
  const notesRequired = !!l2 && l2.startsWith("ni_");

  const erpRefRequired = showAppt && !!lead?.patientName;

  const blockers: string[] = [];
  if (!l1) blockers.push("Pick what happened on the call.");
  else if (l1 === "connected" && !l2) blockers.push("Pick what they said.");
  else if (notesRequired && note.trim().length < 4) blockers.push("Write a short note — required when they are not interested.");
  else if (l2 === "callback_later" && !nextActionDate) blockers.push("Choose when to call again.");
  else if (smsRequired && !smsCopied) blockers.push("Copy the SMS text first — this is call 3.");
  else if (erpRefRequired && !erpRef.trim())
    blockers.push("Write the ERP reference — this booking is for someone else, so it's the only way to match it back to them later.");

  const requeued = isFailedPick && !!lead && lead.attempt < MAX_ATTEMPTS;
  const exhausting = isFailedPick && !!lead && lead.attempt >= MAX_ATTEMPTS;
  const statusText = blockers.length
    ? blockers[0]
    : requeued
      ? `Goes to the back of the queue — comes back around ${nextRunTime()}.`
      : exhausting
        ? "Call 4 of 4 — this closes the lead."
        : "Saves and opens your next lead.";

  async function handleSave() {
    if (!lead || blockers.length) return;
    const l2Meta = LEVEL2.find((o) => o.code === l2);
    const l1Meta = LEVEL1.find((o) => o.code === l1);
    const label = (l2Meta ? l2Meta.label : l1Meta ? l1Meta.label : "Saved") + " — " + lead.name;
    await saveDisposition(lead.id, {
      l1: l1!,
      l2,
      note,
      nextActionDate,
      erpRefType: showAppt ? (l2 === "appointment_purchased" ? "invoice" : "booking") : "",
      erpRefValue: showAppt ? erpRef : "",
      agentId: currentUser.employeeId,
      agentName: currentUser.name,
    });
    setSavedAt(Date.now());
    setSavedLabel(label);
    setCurrentId(null);
    resetDispositionState();
    refreshQueue();
  }

  async function handleEscalateConfirm() {
    if (!lead) return;
    await escalateLead(lead.id, currentUser.employeeId, currentUser.name);
    setEscalateOpen(false);
    setCurrentId(null);
    resetDispositionState();
    refreshQueue();
  }

  function copyPhone() {
    if (!lead) return;
    try {
      navigator.clipboard?.writeText(lead.phone);
    } catch {
      /* clipboard unavailable, ignore */
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  const quickNotes = useMemo(() => (l2 ? QUICK_NOTES[l2] : l1 ? QUICK_NOTES[l1] : []) ?? [], [l1, l2]);

  const savedAgeSec = savedAt ? Math.floor((now - savedAt) / 1000) : Infinity;


  return (
    <div className={styles.page}>
      <aside className={styles.sidebar}>
        <div className={styles.sidebarHeader}>
          <img src="/assets/umch-logo.png" alt="United Healthcare" />
          <div style={{ marginLeft: "auto", textAlign: "right", minWidth: 0 }}>
            <div className={styles.agentName}>{currentUser.name}</div>
            <div className={styles.clock}>{pad(hours)}:{pad(clockDate.getMinutes())}</div>
            <button type="button" className={styles.signOutBtn} onClick={handleSignOut}>
              Sign out
            </button>
          </div>
        </div>

        <div className={styles.statsRow}>
          <div className={styles.statPair}>
            <span className={styles.statNum}>{queue.length}</span>
            <span className={styles.statLabel}>left</span>
          </div>
          <div className={styles.statPair}>
            <span className={styles.statNum} style={{ color: "var(--success)" }}>
              {queue.filter((l) => l.status === "booked").length}
            </span>
            <span className={styles.statLabel}>booked</span>
          </div>
          <button
            type="button"
            className={styles.pauseBtn}
            style={{
              background: presence === "break" ? "#FDF0CE" : "var(--surface-subtle)",
              color: presence === "break" ? "#7A4E06" : "var(--ink-muted)",
            }}
            onClick={() => changePresence(presence === "break" ? "available" : "break")}
          >
            {presence === "break" ? "Back from break" : "On break"}
          </button>
        </div>

        <div className={styles.queueScroll}>
          <div className={styles.sectionHeader}>
            <span className={styles.sectionLabel}>Next up</span>
            <span className={styles.sectionCount}>{fresh.length}</span>
          </div>
          {fresh.map((row) => (
            <button
              key={row.id}
              type="button"
              className={styles.queueRow}
              style={{
                borderLeftColor: slaColor(ageMinutes(row, now)),
                background: lead && row.id === lead.id ? "var(--primary-tint)" : "transparent",
              }}
              onClick={() => openLead(row.id)}
            >
              <div style={{ minWidth: 0, flex: "1 1 auto" }}>
                <div className={styles.queueRowName}>
                  {row.cohort && (
                    <span
                      title={row.cohort}
                      style={{ width: 7, height: 7, borderRadius: "50%", background: cohortColor(row.cohort).fg, flex: "0 0 auto" }}
                    />
                  )}
                  <span
                    className={styles.queueRowNameText}
                    style={{ color: lead && row.id === lead.id ? "var(--primary-dark)" : "var(--ink-secondary)" }}
                  >
                    {row.name}
                  </span>
                  {row.urgent && <span className={styles.vipTag}>VIP</span>}
                </div>
                <div className={styles.queueRowFacility}>{row.facility}</div>
              </div>
              <span className={styles.queueRowAge} style={{ color: slaColor(ageMinutes(row, now)) }}>
                {ageLabel(ageMinutes(row, now))}
              </span>
            </button>
          ))}

          <div className={styles.sectionHeader}>
            <span className={styles.sectionLabel}>Callbacks due</span>
            <span className={styles.sectionCount}>{due.length}</span>
          </div>
          {due.map((row) => (
            <button
              key={row.id}
              type="button"
              className={styles.queueRow}
              style={{ background: lead && row.id === lead.id ? "var(--primary-tint)" : "transparent" }}
              onClick={() => openLead(row.id)}
            >
              <div style={{ minWidth: 0, flex: "1 1 auto" }}>
                <div className={styles.queueRowNameText} style={{ color: "var(--ink-secondary)" }}>
                  {row.name}
                </div>
                <div className={styles.queueRowFacility}>{row.facility}</div>
              </div>
              <span className={styles.queueRowAge} style={{ color: "var(--ink-faint)" }}>
                {row.attempt}/4
              </span>
            </button>
          ))}
        </div>

        <div className={styles.sidebarActions}>
          <button type="button" className={styles.addLeadBtn} onClick={() => setEntryOpen(true)}>
            Add a lead
          </button>
        </div>
        <div className={styles.sidebarSmallActions}>
          <button type="button" className={styles.smallBtn} onClick={() => setSearchOpen(true)}>
            Find a lead
          </button>
          <button type="button" className={styles.smallBtn} onClick={() => alert("Callback logged.")}>
            Log a callback
          </button>
        </div>
      </aside>

      <main className={styles.main}>
        {outOfWindow && !warnAck && (
          <div className={styles.windowWarn}>
            <span className={styles.windowWarnText}>Outside the calling window — VIP and emergency only.</span>
            <button type="button" className={styles.windowWarnBtn} onClick={() => setWarnAck(true)}>
              Got it
            </button>
          </div>
        )}

        {!lead ? (
          <div className={styles.body}>
            <div className={styles.card} style={{ textAlign: "center" }}>
              Nothing waiting right now. Nice work.
            </div>
          </div>
        ) : (
          <>
            <div className={styles.leadHeader}>
              <div style={{ minWidth: 0 }}>
                <div className={styles.leadTitleRow}>
                  <h1 className={styles.leadTitle}>{lead.name}</h1>
                  {lead.urgent && <span className={`${styles.tag} ${styles.tagVip}`}>VIP</span>}
                  {lead.existing && <span className={`${styles.tag} ${styles.tagExisting}`}>EXISTING PATIENT</span>}
                </div>
                <div className={styles.leadSub}>
                  {lead.facility} · {lead.area || "—"}
                </div>
              </div>
              <div className={styles.headerRight}>
                <div className={styles.ladderCol}>
                  <span className={styles.ladderLabel}>Call {lead.attempt} of 4</span>
                  <span className={styles.ladderBar}>
                    {[1, 2, 3, 4].map((n) => (
                      <span key={n} className={styles.ladderSeg} style={{ background: lead.attempt >= n ? "var(--primary)" : "var(--border-input)" }} />
                    ))}
                  </span>
                </div>
                <button type="button" className={styles.escalateBtn} onClick={() => setEscalateOpen(true)}>
                  Send to supervisor
                </button>
              </div>
            </div>

            <div className={styles.body}>
              {claimNotice && (
                <div
                  className={styles.card}
                  style={{ borderColor: "var(--warning)", color: "var(--ink-secondary)", padding: "12px 16px", marginBottom: 12 }}
                >
                  {claimNotice}
                </div>
              )}
              {lead.assignedTo && lead.assignedTo !== currentUser.employeeId && (
                <div
                  className={styles.card}
                  style={{ borderColor: "var(--warning)", background: "#FDF9EE", padding: "12px 16px", marginBottom: 12, color: "#7A4E06" }}
                >
                  You're covering this one while its agent is away — it goes back to them after you log the outcome.
                </div>
              )}
              {presence === "break" ? (
                <div className={`${styles.card} ${styles.pausedCard}`}>
                  <div className={styles.pausedTitle}>On break</div>
                  <div className={styles.pausedSub}>
                    No new leads while you're on break. Anything you hadn't called yet has gone back to the floor.
                  </div>
                  <button type="button" className={styles.resumeBtn} onClick={() => changePresence("available")}>
                    Back from break
                  </button>
                </div>
              ) : phase === "brief" ? (
                <div className={styles.card}>
                  {lead.merged && (
                    <div className={styles.mergedBanner}>
                      <div className={styles.mergedHead}>
                        <span className={styles.mergedHeadText}>
                          Same phone number came in {lead.entries.length || 1} times — treated as one lead
                        </span>
                        <button type="button" className={styles.splitBtn} onClick={async () => { await splitMergedLead(lead.id); refreshQueue(); }}>
                          Not the same person
                        </button>
                      </div>
                      <div className={styles.mergedEntries}>
                        {lead.entries.map((e, i) => (
                          <div key={i} className={styles.mergedEntry}>
                            <span
                              className={styles.entryTag}
                              style={{ background: i === 0 ? "var(--primary-tint)" : "var(--border-light-2)", color: i === 0 ? "var(--primary-dark)" : "var(--ink-muted)" }}
                            >
                              {i === 0 ? "Newest" : "Earlier"}
                            </span>
                            <span style={{ fontWeight: 600, color: "var(--ink-secondary)" }}>{e.service}</span>
                            <span style={{ color: "var(--ink-faint)" }}>
                              {e.channel} · {e.when}
                            </span>
                          </div>
                        ))}
                      </div>
                      <div className={styles.mergedFoot}>One call covers both. Your outcome closes every entry on this number.</div>
                    </div>
                  )}

                  {lead.urgent && (
                    <div className={styles.urgentBanner}>
                      <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
                        <span className={styles.urgentChip}>URGENT</span>
                        <span className={styles.urgentTitle}>Call this one first</span>
                      </div>
                      <div className={styles.urgentReasonText}>{lead.urgentReason}</div>
                      <div className={styles.urgentBy}>Marked urgent by {lead.ownerId} {lead.ownerName}</div>
                    </div>
                  )}

                  <div className={styles.eyebrow}>They asked for</div>
                  <div className={styles.askLine}>{lead.doctor || lead.department || "General enquiry"}</div>
                  <div className={styles.chipsRow}>
                    {(lead.wantDate || lead.preferredTime) && (
                      <span className={`${styles.chip} ${styles.chipDate}`}>
                        {lead.wantDate ? `Wants ${lead.wantDate}` : "Wants"}
                        {lead.preferredTime ? ` · ${lead.preferredTime}` : ""}
                      </span>
                    )}
                    {lead.email && <span className={`${styles.chip} ${styles.chipEmail}`}>{lead.email}</span>}
                    {lead.patientName && (
                      <span className={`${styles.chip} ${styles.chipPatient}`}>
                        Booking is for {lead.patientName} — not the person you are calling
                      </span>
                    )}
                    {lead.cohort && (
                      <button
                        type="button"
                        className={styles.chip}
                        style={{
                          background: cohortColor(lead.cohort).bg,
                          color: cohortColor(lead.cohort).fg,
                          border: "none",
                          cursor: "pointer",
                          font: "inherit",
                        }}
                        onClick={() => toggleCohortNote(lead.cohort)}
                        title="Tap for notes on this batch"
                      >
                        {lead.cohort} {cohortNoteOpen ? "▴" : "▾"}
                      </button>
                    )}
                  </div>
                  {cohortNoteOpen && (
                    <div
                      style={{
                        marginTop: 8,
                        padding: "9px 12px",
                        borderRadius: 7,
                        background: cohortColor(lead.cohort).bg,
                        border: `1px solid ${cohortColor(lead.cohort).border}`,
                        color: cohortColor(lead.cohort).fg,
                        fontSize: 13.5,
                        lineHeight: 1.5,
                      }}
                    >
                      {cohortNoteText || "No notes were left for this batch."}
                    </div>
                  )}
                  <div className={styles.serviceLine}>{serviceLine(lead)}</div>
                  {lead.note && <div className={styles.quote}>{lead.note}</div>}

                  <div className={styles.callRow}>
                    <button
                      type="button"
                      className={styles.copyBtn}
                      title="Copy for the call center panel"
                      style={copied ? { background: "var(--success-tint)", borderColor: "var(--success-tint-border)" } : undefined}
                      onClick={copyPhone}
                    >
                      <span className={styles.copyPhoneText}>{lead.phone}</span>
                      <span className={styles.copyLabelText}>{copied ? "Copied" : "Copy"}</span>
                    </button>
                    <button type="button" className={styles.finishBtn} onClick={() => setPhase("disposition")}>
                      The call is finished
                    </button>
                  </div>
                  <div className={styles.callHint}>Copy the number, call from the call center panel, then come back and press the green button.</div>

                  <div className={styles.detailsToggleWrap}>
                    <button type="button" className={styles.detailsToggleBtn} onClick={() => setDetailsOpen((v) => !v)}>
                      {detailsOpen ? "Hide lead details" : "Where did this lead come from?"}
                    </button>
                    {detailsOpen && (
                      <div className={styles.detailsGrid}>
                        <div>
                          <div className={styles.detailLabel}>Came from</div>
                          <div className={styles.detailValue}>{lead.channel}</div>
                        </div>
                        <div>
                          <div className={styles.detailLabel}>Enquiry type</div>
                          <div className={styles.detailValue}>{leadTypeLabel(lead.leadType)}</div>
                        </div>
                        <div>
                          <div className={styles.detailLabel}>Waiting</div>
                          <div className={styles.detailValue}>
                            {ageLabel(ageMinutes(lead, now))} · {lead.id}
                          </div>
                        </div>
                        {lead.ownerId && (
                          <div>
                            <div className={styles.detailLabel}>Entered by</div>
                            <div className={styles.detailValue}>{lead.ownerId} {lead.ownerName}</div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className={`${styles.card} ${styles.dispCard}`}>
                  <div className={styles.dispHeaderRow}>
                    <div className={styles.dispTitle}>What happened on the call?</div>
                  </div>

                  <div className={styles.optGrid}>
                    {LEVEL1.map((o) => {
                      const on = l1 === o.code;
                      return (
                        <button
                          key={o.code}
                          type="button"
                          className={styles.optBtn}
                          style={on ? { background: "var(--primary)", color: "#fff", borderColor: "var(--primary)" } : undefined}
                          onClick={() => {
                            setL1(o.code);
                            if (o.code !== "connected") setL2(null);
                            setNote("");
                          }}
                        >
                          {o.label}
                        </button>
                      );
                    })}
                  </div>

                  {l1 === "connected" && (
                    <div className={styles.sectionDivider}>
                      <div className={styles.subheading}>What did they say?</div>
                      <div className={styles.optGridWide}>
                        {LEVEL2.map((o) => {
                          const on = l2 === o.code;
                          const tint = o.kind === "win" ? "var(--success)" : o.kind === "lost" ? "var(--danger)" : "var(--primary)";
                          return (
                            <button
                              key={o.code}
                              type="button"
                              className={`${styles.optBtn} ${styles.optBtnSmall}`}
                              style={on ? { background: tint, color: "#fff", borderColor: tint } : undefined}
                              onClick={() => {
                                setL2(o.code);
                                setNote("");
                              }}
                            >
                              {o.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {showAppt && (
                    <div className={styles.sectionDivider}>
                      <label className={styles.refField}>
                        <span className={styles.refLabel}>
                          {l2 === "appointment_purchased" ? "Invoice number from the ERP" : "Booking ID from the ERP"}{" "}
                          {erpRefRequired ? (
                            <span style={{ fontSize: 13, fontWeight: 500, color: "var(--danger)" }}>— required, booked for someone else</span>
                          ) : (
                            <span style={{ fontSize: 13, fontWeight: 500, color: "var(--ink-faint)" }}>— optional</span>
                          )}
                        </span>
                        <input
                          value={erpRef}
                          onChange={(e) => setErpRef(e.target.value)}
                          placeholder={l2 === "appointment_purchased" ? "INV-…" : "BKG-…"}
                          className={styles.refInput}
                        />
                      </label>
                      {smsTemplates.sms_booking_confirm && (
                        <SmsCopyBox
                          title="Booking confirmation SMS"
                          text={fillTemplate(smsTemplates.sms_booking_confirm, {
                            name: lead.name,
                            date: lead.wantDate,
                            time: lead.preferredTime,
                            doctor: lead.doctor,
                            facility: lead.facility,
                          })}
                          copied={bookingSmsCopied}
                          onCopy={() => setBookingSmsCopied(true)}
                        />
                      )}
                    </div>
                  )}

                  {showNextAction && (
                    <div className={styles.sectionDivider}>
                      <div className={styles.subheading} style={{ marginBottom: 0 }}>
                        When should we call again?
                      </div>
                      <div className={styles.dateChipsRow}>
                        {[
                          { d: 0, label: "Later today" },
                          { d: 1, label: "Tomorrow" },
                          { d: 2, label: "In 2 days" },
                          { d: 7, label: "Next week" },
                        ].map((c) => {
                          const on = nextActionDate === isoPlus(c.d);
                          return (
                            <button
                              key={c.d}
                              type="button"
                              className={styles.dateChip}
                              style={on ? { background: "var(--primary)", color: "#fff", borderColor: "var(--primary)" } : undefined}
                              onClick={() => setNextActionDate(isoPlus(c.d))}
                            >
                              {c.label}
                            </button>
                          );
                        })}
                        <input
                          type="date"
                          value={nextActionDate}
                          onChange={(e) => setNextActionDate(e.target.value)}
                          className={styles.dateInput}
                          style={{ borderColor: nextActionDate ? "var(--success-tint-border)" : "var(--border-input)" }}
                        />
                      </div>
                      {nextActionDate && smsTemplates.sms_callback_confirm && (
                        <SmsCopyBox
                          title="Callback confirmation SMS"
                          text={fillTemplate(smsTemplates.sms_callback_confirm, { name: lead.name, date: nextActionDate })}
                          copied={callbackSmsCopied}
                          onCopy={() => setCallbackSmsCopied(true)}
                        />
                      )}
                    </div>
                  )}

                  {!!l1 && FAILED.includes(l1) && smsTemplates.sms_missed_call && (
                    <div className={styles.sectionDivider}>
                      <SmsCopyBox
                        title="Missed-call SMS"
                        text={fillTemplate(smsTemplates.sms_missed_call, { name: lead.name })}
                        required={smsRequired}
                        copied={smsCopied}
                        onCopy={() => setSmsCopied(true)}
                      />
                    </div>
                  )}

                  {!!l1 && (
                    <div className={styles.sectionDivider}>
                      <div className={styles.notesHeadRow}>
                        <span className={styles.notesHeading}>Notes</span>
                        <span className={styles.notesHint} style={{ color: notesRequired ? "var(--danger)" : "var(--ink-faint)" }}>
                          {notesRequired ? "Required" : "Optional"}
                        </span>
                      </div>
                      {quickNotes.length > 0 && (
                        <div className={styles.quickNotesRow}>
                          {quickNotes.map((q) => {
                            const on = note.includes(q);
                            return (
                              <button
                                key={q}
                                type="button"
                                className={styles.quickNoteBtn}
                                style={on ? { background: "var(--primary)", color: "#fff", borderColor: "var(--primary)" } : undefined}
                                onClick={() =>
                                  setNote((cur) => (cur.includes(q) ? cur.replace(q, "").replace(/\s{2,}/g, " ").trim() : cur ? cur + " " + q : q))
                                }
                              >
                                {q}
                              </button>
                            );
                          })}
                        </div>
                      )}
                      <textarea
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        rows={2}
                        placeholder="Anything the next agent needs to know…"
                        className={styles.notesTextarea}
                        style={{ borderColor: notesRequired && note.trim().length < 4 ? "#E0A9A2" : "var(--border-input)" }}
                      />
                    </div>
                  )}

                  <div className={styles.saveRow}>
                    <button
                      type="button"
                      disabled={blockers.length > 0}
                      className={styles.saveBtn}
                      style={{ background: blockers.length ? "var(--disabled-btn)" : "var(--primary)", opacity: blockers.length ? 0.75 : 1 }}
                      onClick={handleSave}
                    >
                      Save &amp; next lead
                    </button>
                    <div className={styles.saveStatus} style={{ color: blockers.length ? "var(--danger)" : "var(--ink-faint)" }}>
                      {statusText}
                    </div>
                  </div>
                </div>
              )}

              {savedAt !== null && savedAgeSec < 900 && (
                <div className={styles.savedBanner}>
                  <span className={styles.savedText}>Saved · {savedLabel}</span>
                </div>
              )}

              {lead.history.length > 0 && (
                <div className={`${styles.card} ${styles.historyCard}`}>
                  <div className={styles.historyTitle}>Earlier calls</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                    {lead.history.map((h, i) => {
                      const l2o = LEVEL2.find((o) => o.code === h.l2);
                      const l1o = LEVEL1.find((o) => o.code === h.l1);
                      return (
                        <div key={i} className={styles.historyRow}>
                          <span className={styles.historyWhen}>{h.when}</span>
                          <span className={styles.historyOutcome} style={{ color: h.l1 === "connected" ? "var(--primary-dark)" : "var(--danger)" }}>
                            {l2o ? l2o.label : l1o ? l1o.label : h.l1}
                          </span>
                          <span className={styles.historyNote}>{h.note}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </main>

      {searchOpen && (
        <SearchModal
          term={searchTerm}
          onTermChange={setSearchTerm}
          onJump={(id) => {
            setCurrentId(id);
            resetDispositionState();
            setSearchOpen(false);
            setSearchTerm("");
          }}
          onClose={() => {
            setSearchOpen(false);
            setSearchTerm("");
          }}
        />
      )}

      {escalateOpen && <EscalateModal onConfirm={handleEscalateConfirm} onClose={() => setEscalateOpen(false)} />}

      {entryOpen && (
        <AddLeadModal
          currentUser={currentUser}
          onClose={() => setEntryOpen(false)}
          onSaved={() => refreshQueue()}
        />
      )}
    </div>
  );
}
