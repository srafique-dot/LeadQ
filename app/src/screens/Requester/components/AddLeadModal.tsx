import { useEffect, useRef, useState, type ReactNode } from "react";
import styles from "../Requester.module.css";
import { useMediaQuery } from "../../../hooks/useMediaQuery";
import { digitsOf, findLeadByPhone, createLead, mergeIntoLead, serviceLine, statusLabel } from "../../../api/leads";
import type { Account, Lead, LeadType } from "../../../api/types";

/** Wraps the Bangla half of a bilingual label so it renders in Hind
 * Siliguri at a size/weight balanced against the English half — at equal
 * font-size Bangla glyphs read visibly larger and heavier. */
function Bn({ children }: { children: ReactNode }) {
  return <span className="bn">{children}</span>;
}

interface AddLeadModalProps {
  currentUser: Account;
  onClose: () => void;
  onSaved: (message: string) => void;
}

const HOSPITALS = ["UMCH Main", "Medix Uttara", "MA Rashid Clinic"];
const TIME_SLOTS = ["Morning", "Afternoon", "Evening"];
const SOURCES = [
  { value: "Manual entry", label: "Phone-in / walk-in / ফোন বা সরাসরি" },
  { value: "Website LP", label: "Website enquiry / ওয়েবসাইট" },
  { value: "Door2Door Campaign", label: "Door-to-door campaign / ডোর টু ডোর ক্যাম্পেইন" },
];
const LEAD_TYPES: { value: LeadType; label: string }[] = [
  { value: "appointment", label: "Doctor appointment / ডাক্তারের অ্যাপয়েন্টমেন্ট" },
  { value: "vaccine_query", label: "Vaccine query / টিকা সংক্রান্ত জিজ্ঞাসা" },
  { value: "lab_test", label: "Lab tests / ল্যাব টেস্ট" },
  { value: "radiology", label: "Radiology / রেডিওলজি" },
  { value: "investigative_procedure", label: "Investigative procedure / তদন্তমূলক প্রসিডিউর" },
  { value: "surgery_package", label: "Surgery package / সার্জারি প্যাকেজ" },
  { value: "health_package", label: "Health package / স্বাস্থ্য প্যাকেজ" },
  { value: "therapy", label: "Therapies / থেরাপি" },
  { value: "dialysis", label: "Dialysis / ডায়ালাইসিস" },
  { value: "ipd", label: "IPD admission / আইপিডি ভর্তি" },
  { value: "day_care", label: "Day care / ডে কেয়ার" },
  { value: "international_patient", label: "International patient / আন্তর্জাতিক রোগী" },
  { value: "general_inquiry", label: "General inquiry / সাধারণ জিজ্ঞাসা" },
];

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
  const [preferredTime, setPreferredTime] = useState("");
  const [email, setEmail] = useState("");
  const [source, setSource] = useState(SOURCES[0].value);
  const [leadType, setLeadType] = useState<LeadType>(LEAD_TYPES[0].value);
  const [urgent, setUrgent] = useState(false);
  const [urgentReason, setUrgentReason] = useState("");
  const [forOther, setForOther] = useState(false);
  const [patient, setPatient] = useState("");
  const [note, setNote] = useState("");
  const [justSaved, setJustSaved] = useState("");
  const phoneRef = useRef<HTMLInputElement>(null);

  const digits = digitsOf(phone);
  const [dup, setDup] = useState<Lead | null>(null);
  useEffect(() => {
    if (digits.length < 7) {
      setDup(null);
      return;
    }
    let cancelled = false;
    findLeadByPhone(phone).then((d) => {
      if (!cancelled) setDup(d ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [phone, digits.length]);

  const phoneChecking = digits.length > 0 && digits.length < 7;
  const phoneClear = digits.length >= 7 && !dup;
  const phoneBorder = dup ? "#E0C98F" : digits.length >= 7 ? "#B7E0D0" : "var(--border-input)";

  function setPhoneValue(v: string) {
    setPhone(v);
    setEntryMode(null);
    setJustSaved("");
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

  async function performSave(): Promise<string> {
    if (isMerging && dup) {
      await mergeIntoLead(dup.id);
      onSaved(`Added to ${dup.name} — the agent still sees one lead. Logged against ${currentUser.employeeId}.`);
      return dup.name;
    }
    const created = await createLead(
      { name, phone, leadType, facility, area, doctor, department: dept, patientName: forOther ? patient : "", wantDate, preferredTime, email, note, urgent, urgentReason, cohort: "" },
      currentUser.employeeId,
      currentUser.name,
      source,
    );
    onSaved(
      urgent
        ? `${created.name} is first in the queue — marked urgent by ${currentUser.employeeId} ${currentUser.name}`
        : `${created.name} is in the queue · created by ${currentUser.employeeId} ${currentUser.name}`,
    );
    return created.name;
  }

  function clearForNextLead() {
    setPhone("");
    setEntryMode(null);
    setName("");
    setArea("");
    setDoctor("");
    setDept("");
    setWantDate("");
    setPreferredTime("");
    setEmail("");
    setUrgent(false);
    setUrgentReason("");
    setForOther(false);
    setPatient("");
    setNote("");
    // source, leadType and facility are left as-is — a rapid-entry batch usually shares them.
  }

  async function handleSave() {
    if (blocked) return;
    await performSave();
    onClose();
  }

  async function handleSaveAndAddAnother() {
    if (blocked) return;
    const savedName = await performSave();
    clearForNextLead();
    setJustSaved(savedName);
    phoneRef.current?.focus();
  }

  return (
    <div className={`${styles.overlay} ${narrow ? styles.sheet : ""}`}>
      <div className={`${styles.modalCard} ${narrow ? styles.sheet : ""}`}>
        <div className={styles.modalHeader}>
          <div style={{ minWidth: 0 }}>
            <div className={styles.modalTitle}>
              Add a lead / <Bn>নতুন লিড</Bn>
            </div>
            <div className={styles.modalSubtitle}>
              Saved under <span style={{ fontWeight: 600, color: "var(--ink-secondary)" }}>{currentUser.name}</span> ·{" "}
              {currentUser.employeeId}
            </div>
          </div>
          <button type="button" className={styles.modalClose} onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        {justSaved && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "10px 24px",
              flex: "0 0 auto",
              background: "var(--success-tint)",
              borderBottom: "1px solid var(--success-tint-border)",
              color: "var(--success-dark)",
              fontSize: 14,
              fontWeight: 500,
            }}
          >
            ✓ {justSaved} added — keep going, or close when the batch is done.
          </div>
        )}

        <div className={styles.modalBody}>
          <div className={styles.twoCol}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>
                How did this lead come in? / <Bn>এই লিড কীভাবে এসেছে</Bn>
              </span>
              <select value={source} onChange={(e) => setSource(e.target.value)} className={styles.textInput}>
                {SOURCES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>
                What is this about? / <Bn>এটি কী বিষয়ে</Bn>
              </span>
              <select value={leadType} onChange={(e) => setLeadType(e.target.value as LeadType)} className={styles.textInput}>
                {LEAD_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className={styles.field}>
            <span className={styles.fieldLabel}>
              Phone number / <Bn>ফোন নম্বর</Bn>
            </span>
            <input
              ref={phoneRef}
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
            <span className={styles.fieldLabel}>
              Name / <Bn>নাম</Bn>
            </span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Full name as they gave it"
              className={styles.textInput}
            />
          </label>

          <label className={styles.field}>
            <span className={styles.fieldLabel}>
              Email / <Bn>ইমেইল</Bn> <span className={styles.muted}>— optional / <Bn>ঐচ্ছিক</Bn></span>
            </span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@example.com"
              className={styles.textInput}
            />
          </label>

          <div className={styles.twoCol}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>
                Which hospital / <Bn>কোন হাসপাতাল</Bn>
              </span>
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
              <span className={styles.fieldLabel}>
                Area / <Bn>এলাকা</Bn>
              </span>
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
              <span className={styles.fieldLabel}>
                Which doctor did they ask for / <Bn>কোন ডাক্তার চেয়েছেন</Bn>
              </span>
              <input
                value={doctor}
                onChange={(e) => setDoctor(e.target.value)}
                placeholder="e.g. Prof. A. Q. M. Mohsen"
                className={styles.textInput}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>
                Department / <Bn>বিভাগ</Bn> <span className={styles.muted}>— if no doctor named / <Bn>ডাক্তারের নাম না থাকলে</Bn></span>
              </span>
              <input
                value={dept}
                onChange={(e) => setDept(e.target.value)}
                placeholder="e.g. Gynaecology"
                className={styles.textInput}
              />
            </label>
          </div>

          <div className={styles.twoCol}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>
                Which day do they want / <Bn>কোন দিন চান</Bn> <span className={styles.muted}>— optional / <Bn>ঐচ্ছিক</Bn></span>
              </span>
              <input
                type="date"
                value={wantDate}
                onChange={(e) => setWantDate(e.target.value)}
                className={styles.textInput}
              />
              {!wantDate && <span className={styles.hint}>Leave it empty if they did not say — you can add it later.</span>}
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>
                Which time / <Bn>কোন সময়</Bn> <span className={styles.muted}>— optional / <Bn>ঐচ্ছিক</Bn></span>
              </span>
              <select value={preferredTime} onChange={(e) => setPreferredTime(e.target.value)} className={styles.textInput}>
                <option value="">No preference…</option>
                {TIME_SLOTS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div
            className={styles.urgentPanel}
            style={urgent ? { background: "var(--danger-tint)", borderColor: "var(--danger-tint-border)" } : undefined}
          >
            <button type="button" className={styles.urgentToggle} onClick={() => setUrgent((v) => !v)}>
              <span className={`${styles.checkMark} ${urgent ? styles.checked : ""}`}>{urgent ? "✓" : ""}</span>
              <span style={{ minWidth: 0 }}>
                <span className={styles.urgentLabel} style={{ color: urgent ? "var(--danger)" : "var(--ink-secondary)" }}>
                  Call this one first / <Bn>প্রথমে এটি কল করুন</Bn>
                </span>
                <span className={styles.urgentSub}>
                  VIP, referred by a doctor, or genuinely time-critical. It jumps ahead of everything waiting.
                </span>
              </span>
            </button>
            {urgent && (
              <label className={styles.field} style={{ marginTop: 14 }}>
                <span className={styles.fieldLabel}>
                  Why / <Bn>কেন</Bn> <span className={styles.required}>— required / <Bn>আবশ্যক</Bn></span>
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
              {forOther ? (
                <>
                  The caller is the patient / <Bn>কলকারী নিজেই রোগী</Bn>
                </>
              ) : (
                <>
                  This booking is for someone else / <Bn>এই বুকিং অন্য কারো জন্য</Bn>
                </>
              )}
            </button>
            {forOther && (
              <label className={styles.field} style={{ marginTop: 12 }}>
                <span className={styles.fieldLabel}>
                  Patient’s name / <Bn>রোগীর নাম</Bn>
                </span>
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
              What they said / <Bn>তারা কী বলেছে</Bn> <span className={styles.muted}>— optional / <Bn>ঐচ্ছিক</Bn></span>
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
            onClick={handleSaveAndAddAnother}
            className={styles.btnImport}
            style={{ minHeight: 48, opacity: blocked ? 0.6 : 1 }}
          >
            Save &amp; add another / <Bn>সংরক্ষণ করে আরেকটি যোগ করুন</Bn>
          </button>
          <button
            type="button"
            disabled={blocked}
            onClick={handleSave}
            className={styles.saveBtn}
            style={{ background: blocked ? "var(--disabled-btn)" : "var(--primary)", opacity: blocked ? 0.75 : 1 }}
          >
            {isMerging ? (
              <>
                Add to existing lead / <Bn>বিদ্যমান লিডে যোগ করুন</Bn>
              </>
            ) : (
              <>
                Create lead &amp; close / <Bn>লিড তৈরি করে বন্ধ করুন</Bn>
              </>
            )}
          </button>
          <div className={styles.footerStatus} style={{ color: blocked ? "var(--danger)" : "var(--ink-faint)" }}>
            {status}
          </div>
        </div>
      </div>
    </div>
  );
}
