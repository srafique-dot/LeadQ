import { useMemo, useState } from "react";
import styles from "../Requester.module.css";
import { useMediaQuery } from "../../../hooks/useMediaQuery";
import { digitsOf, findLeadByPhone, createLead, mergeIntoLead, serviceLine, statusLabel } from "../../../api/leads";
import type { Account } from "../../../api/types";

interface AddLeadModalProps {
  currentUser: Account;
  onClose: () => void;
  onSaved: (message: string) => void;
}

const HOSPITALS = ["UMCH Main", "Medix Uttara", "MA Rashid Clinic"];

type EntryMode = "merge" | "separate" | null;

export function AddLeadModal({ currentUser, onClose, onSaved }: AddLeadModalProps) {
  const narrow = useMediaQuery("(max-width: 640px)");

  const [phone, setPhone] = useState("");
  const [entryMode, setEntryMode] = useState<EntryMode>(null);
  const [name, setName] = useState("");
  const [facility, setFacility] = useState("");
  const [area, setArea] = useState("");
  const [doctor, setDoctor] = useState("");
  const [dept, setDept] = useState("");
  const [wantDate, setWantDate] = useState("");
  const [urgent, setUrgent] = useState(false);
  const [urgentReason, setUrgentReason] = useState("");
  const [forOther, setForOther] = useState(false);
  const [patient, setPatient] = useState("");
  const [note, setNote] = useState("");

  const digits = digitsOf(phone);
  const dup = useMemo(() => (digits.length >= 7 ? (findLeadByPhone(phone) ?? null) : null), [phone, digits.length]);

  const phoneChecking = digits.length > 0 && digits.length < 7;
  const phoneClear = digits.length >= 7 && !dup;
  const phoneBorder = dup ? "#E0C98F" : digits.length >= 7 ? "#B7E0D0" : "var(--border-input)";

  function setPhoneValue(v: string) {
    setPhone(v);
    setEntryMode(null);
  }

  const blockers: string[] = [];
  if (!name.trim()) blockers.push("Write the caller’s name.");
  else if (digits.length < 10) blockers.push("Write the full phone number.");
  else if (dup && !entryMode) blockers.push("This number already exists — choose one of the two options above.");
  else if (!facility.trim()) blockers.push("Choose which hospital.");
  else if (!doctor.trim() && !dept.trim())
    blockers.push("Write the doctor they asked for, or the department if they did not name one.");
  else if (forOther && !patient.trim()) blockers.push("Write the patient’s name.");
  else if (urgent && !urgentReason.trim()) blockers.push("Say why this one jumps the queue.");

  const isMerging = !!dup && entryMode === "merge";
  const blocked = blockers.length > 0;

  const status = blocked
    ? blockers[0]
    : isMerging
      ? `Adds this enquiry to ${dup!.name} — no new card for the agent.`
      : urgent
        ? "Goes to the front of the queue — the next free agent gets it."
        : "Goes to the call centre with a 5 minute call target.";

  function handleSave() {
    if (blocked) return;
    if (isMerging && dup) {
      mergeIntoLead(dup.id);
      onSaved(`Added to ${dup.name} — the agent still sees one lead. Logged against ${currentUser.employeeId}.`);
    } else {
      const created = createLead(
        { name, phone, facility, area, doctor, department: dept, patientName: forOther ? patient : "", wantDate, note, urgent, urgentReason, cohort: "" },
        currentUser.employeeId,
        currentUser.name,
      );
      onSaved(
        urgent
          ? `${created.name} is first in the queue — marked urgent by ${currentUser.employeeId} ${currentUser.name}`
          : `${created.name} is in the queue · created by ${currentUser.employeeId} ${currentUser.name}`,
      );
    }
    onClose();
  }

  return (
    <div className={`${styles.overlay} ${narrow ? styles.sheet : ""}`}>
      <div className={`${styles.modalCard} ${narrow ? styles.sheet : ""}`}>
        <div className={styles.modalHeader}>
          <div style={{ minWidth: 0 }}>
            <div className={styles.modalTitle}>Add a lead</div>
            <div className={styles.modalSubtitle}>
              Saved under <span style={{ fontWeight: 600, color: "var(--ink-secondary)" }}>{currentUser.name}</span> ·{" "}
              {currentUser.employeeId}
            </div>
          </div>
          <button type="button" className={styles.modalClose} onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className={styles.modalBody}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Phone number</span>
            <input
              value={phone}
              onChange={(e) => setPhoneValue(e.target.value)}
              placeholder="+880 1XXX XXX XXX"
              className={styles.phoneInput}
              style={{ borderWidth: 1.5, borderStyle: "solid", borderColor: phoneBorder }}
            />
            {phoneChecking && <span className={styles.hint}>Keep typing — we check for duplicates as you go.</span>}
            {phoneClear && (
              <span className={styles.hint} style={{ color: "var(--success-dark)", fontWeight: 500 }}>
                New number — no existing lead.
              </span>
            )}
          </label>

          {dup && (
            <div className={styles.dupBlock}>
              <div className={styles.dupTitle}>This number is already in the system</div>
              <div className={styles.dupCard}>
                <div className={styles.dupNameRow}>
                  <span className={styles.dupName}>{dup.name}</span>
                  <span className={styles.dupPhone}>{dup.phone}</span>
                </div>
                <div className={styles.dupMeta}>
                  {serviceLine(dup)} · {dup.facility}
                  <br />
                  {statusLabel(dup.status)} · {dup.detail} · added by {dup.ownerId} {dup.ownerName}
                </div>
              </div>
              <div className={styles.dupQuestion}>What do you want to do?</div>
              <div className={styles.dupOptions}>
                <button
                  type="button"
                  className={styles.dupOptionBtn}
                  style={
                    entryMode === "merge"
                      ? { background: "var(--primary)", color: "#fff", borderColor: "var(--primary)" }
                      : undefined
                  }
                  onClick={() => setEntryMode("merge")}
                >
                  Same person — add to that lead
                </button>
                <button
                  type="button"
                  className={styles.dupOptionBtn}
                  style={
                    entryMode === "separate"
                      ? { background: "var(--primary)", color: "#fff", borderColor: "var(--primary)" }
                      : undefined
                  }
                  onClick={() => setEntryMode("separate")}
                >
                  Different person — create separate
                </button>
              </div>
            </div>
          )}

          <label className={styles.field}>
            <span className={styles.fieldLabel}>Name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Full name as they gave it"
              className={styles.textInput}
            />
          </label>

          <div className={styles.twoCol}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Which hospital</span>
              <select value={facility} onChange={(e) => setFacility(e.target.value)} className={styles.textInput}>
                <option value="">Choose one…</option>
                {HOSPITALS.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Area</span>
              <input
                value={area}
                onChange={(e) => setArea(e.target.value)}
                placeholder="Where they live"
                className={styles.textInput}
              />
            </label>
          </div>

          <div className={styles.twoCol}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Which doctor did they ask for</span>
              <input
                value={doctor}
                onChange={(e) => setDoctor(e.target.value)}
                placeholder="e.g. Prof. A. Q. M. Mohsen"
                className={styles.textInput}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>
                Department <span className={styles.muted}>— if no doctor named</span>
              </span>
              <input
                value={dept}
                onChange={(e) => setDept(e.target.value)}
                placeholder="e.g. Gynaecology"
                className={styles.textInput}
              />
            </label>
          </div>

          <label className={styles.field}>
            <span className={styles.fieldLabel}>
              Which day do they want <span className={styles.muted}>— optional</span>
            </span>
            <input
              type="date"
              value={wantDate}
              onChange={(e) => setWantDate(e.target.value)}
              className={styles.textInput}
              style={{ maxWidth: 220 }}
            />
            {!wantDate && <span className={styles.hint}>Leave it empty if they did not say — you can add it later.</span>}
          </label>

          <div
            className={styles.urgentPanel}
            style={urgent ? { background: "var(--danger-tint)", borderColor: "var(--danger-tint-border)" } : undefined}
          >
            <button type="button" className={styles.urgentToggle} onClick={() => setUrgent((v) => !v)}>
              <span className={`${styles.checkMark} ${urgent ? styles.checked : ""}`}>{urgent ? "✓" : ""}</span>
              <span style={{ minWidth: 0 }}>
                <span className={styles.urgentLabel} style={{ color: urgent ? "var(--danger)" : "var(--ink-secondary)" }}>
                  Call this one first
                </span>
                <span className={styles.urgentSub}>
                  VIP, referred by a doctor, or genuinely time-critical. It jumps ahead of everything waiting.
                </span>
              </span>
            </button>
            {urgent && (
              <label className={styles.field} style={{ marginTop: 14 }}>
                <span className={styles.fieldLabel}>
                  Why <span className={styles.required}>— required</span>
                </span>
                <input
                  value={urgentReason}
                  onChange={(e) => setUrgentReason(e.target.value)}
                  placeholder="e.g. Board member’s mother, referred by Prof. Mohsen"
                  className={styles.textInput}
                />
                <span className={styles.hint}>
                  The agent sees this reason and your name on it. Team leads review how often urgent gets used.
                </span>
              </label>
            )}
          </div>

          <div className={styles.forOtherWrap}>
            <button
              type="button"
              className={styles.forOtherToggle}
              onClick={() => {
                setForOther((v) => !v);
                setPatient("");
              }}
            >
              {forOther ? "The caller is the patient" : "This booking is for someone else"}
            </button>
            {forOther && (
              <label className={styles.field} style={{ marginTop: 12 }}>
                <span className={styles.fieldLabel}>Patient’s name</span>
                <input
                  value={patient}
                  onChange={(e) => setPatient(e.target.value)}
                  placeholder="Who the appointment is for"
                  className={styles.textInput}
                />
                <span className={styles.hint}>The agent calls the number above, but books under this name.</span>
              </label>
            )}
          </div>

          <label className={styles.field}>
            <span className={styles.fieldLabel}>
              What they said <span className={styles.muted}>— optional</span>
            </span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="In their own words if you have it"
              className={styles.textarea}
            />
          </label>
        </div>

        <div className={`${styles.modalFooter} ${narrow ? styles.sheet : ""}`}>
          <button
            type="button"
            disabled={blocked}
            onClick={handleSave}
            className={styles.saveBtn}
            style={{ background: blocked ? "var(--disabled-btn)" : "var(--primary)", opacity: blocked ? 0.75 : 1 }}
          >
            {isMerging ? "Add to existing lead" : "Create lead"}
          </button>
          <div className={styles.footerStatus} style={{ color: blocked ? "var(--danger)" : "var(--ink-faint)" }}>
            {status}
          </div>
        </div>
      </div>
    </div>
  );
}
