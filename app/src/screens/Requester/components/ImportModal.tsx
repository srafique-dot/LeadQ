import { useRef, useState } from "react";
import styles from "../Requester.module.css";
import { importLeads, type ImportRow, type ImportResult } from "../../../api/leads";
import type { Account, LeadType } from "../../../api/types";

interface ImportModalProps {
  currentUser: Account;
  onClose: () => void;
  onImported: (result: ImportResult, cohort: string) => void;
}

const RECENT_BATCHES = ["Sep health camp — Uttara", "Meta ads — Sep", "Corporate: Brac Bank"];

/** Website "Interested in" / "Category" text → our lead type. Case-insensitive
 * on the trimmed value. Anything unrecognized falls back to general_inquiry
 * rather than rejecting the row — better an under-tagged lead than a dropped one. */
const CATEGORY_TO_LEAD_TYPE: Record<string, LeadType> = {
  "appointment": "appointment",
  "surgery": "surgery_package",
  "surgery packages": "surgery_package",
  "surgery package": "surgery_package",
  "general inquiry": "general_inquiry",
  "general inquiries": "general_inquiry",
  "health package": "health_package",
  "health packages": "health_package",
  "health package inquiry": "health_package",
  "corporate health": "corporate_health",
  "vaccine query": "vaccine_query",
  "lab test": "lab_test",
  "lab tests": "lab_test",
  "radiology": "radiology",
  "investigative procedure": "investigative_procedure",
  "therapy": "therapy",
  "therapies": "therapy",
  "dialysis": "dialysis",
  "ipd": "ipd",
  "ipd admission": "ipd",
  "day care": "day_care",
  "international patient": "international_patient",
  "booking an appointment": "appointment",
  "emergency assistance": "appointment",
};
const URGENT_CATEGORIES = new Set(["emergency assistance"]);
const BLANK_PLACEHOLDERS = new Set(["—", "-", "–", "n/a", "na"]);

function clean(v: string | undefined): string {
  const t = (v ?? "").trim();
  return BLANK_PLACEHOLDERS.has(t.toLowerCase()) ? "" : t;
}

/** Splits one delimited line respecting double-quoted fields (so a quoted
 * "Sep 20, 2026" isn't torn apart by its own comma), the way a real
 * spreadsheet export needs. */
function splitDelimited(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

const emptyRow = (name: string, phone: string, facility: string, doctor: string): ImportRow => ({
  name,
  phone,
  facility,
  doctor,
  department: "",
  email: "",
  note: "",
  leadType: "general_inquiry",
  wantDate: "",
  preferredTime: "",
  urgent: false,
  urgentReason: "",
});

/** Recognizes the hospital's real website export shapes (consultation
 * bookings, general/package/surgery enquiries, the corporate lead form —
 * each with a different column layout) by header name rather than column
 * position, so it survives the columns being reordered or a form changing.
 * Falls back to a plain name/phone/facility/department 4-column file
 * (the original, simplest shape) when no recognized headers are found. */
function parseImportFile(text: string): ImportRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (!lines.length) return [];

  const tabCount = (lines[0].match(/\t/g) ?? []).length;
  const commaCount = (lines[0].match(/,/g) ?? []).length;
  const delimiter = tabCount > commaCount ? "\t" : ",";

  const header = splitDelimited(lines[0], delimiter).map((h) => h.toLowerCase());
  const col = (...names: string[]): number => {
    for (const n of names) {
      const i = header.indexOf(n);
      if (i !== -1) return i;
    }
    return -1;
  };

  const iName = col("patient name", "name");
  const iPhone = col("phone", "mobile");

  if (iName === -1 || iPhone === -1) {
    // Legacy/plain shape: name, phone, facility, department — no recognized header.
    const first = splitDelimited(lines[0], delimiter);
    const hasHeader = first[0]?.toLowerCase() === "name";
    const dataLines = hasHeader ? lines.slice(1) : lines;
    return dataLines
      .map((l) => splitDelimited(l, delimiter))
      .filter((cols) => cols.length >= 2 && cols[0] && cols[1])
      .map((cols) => emptyRow(cols[0] ?? "", cols[1] ?? "", clean(cols[2]), clean(cols[3])));
  }

  const iEmail = col("email");
  const iFacility = col("facility name", "facility code", "facility");
  const iDoctor = col("doctor name", "doctor");
  const iDept = col("department");
  const iWantDate = col("preferred date", "date");
  const iTime = col("time slot", "preferred time");
  const iCategory = col("category");
  const iInterestedIn = col("interested in");
  const iNotes = col("notes", "message", "note");

  return lines
    .slice(1)
    .map((l) => splitDelimited(l, delimiter))
    .filter((cols) => cols.length > Math.max(iName, iPhone) && cols[iName] && cols[iPhone])
    .map((cols) => {
      // "Category" (when present) is the reliable type signal; "Interested in"
      // then becomes extra descriptive text folded into the note. When there's
      // no separate Category column, "Interested in" itself holds the type
      // (e.g. the corporate lead form's "Booking an Appointment").
      const categoryRaw = clean(iCategory !== -1 ? cols[iCategory] : iInterestedIn !== -1 ? cols[iInterestedIn] : "");
      const categoryKey = categoryRaw.toLowerCase();
      const leadType = CATEGORY_TO_LEAD_TYPE[categoryKey] ?? "general_inquiry";
      const urgent = URGENT_CATEGORIES.has(categoryKey);
      const extraDetail = iCategory !== -1 && iInterestedIn !== -1 ? clean(cols[iInterestedIn]) : "";
      const note = [extraDetail, iNotes !== -1 ? clean(cols[iNotes]) : ""].filter(Boolean).join(" — ");

      return {
        name: cols[iName] ?? "",
        phone: cols[iPhone] ?? "",
        facility: iFacility !== -1 ? clean(cols[iFacility]) : "",
        doctor: iDoctor !== -1 ? clean(cols[iDoctor]) : "",
        department: iDept !== -1 ? clean(cols[iDept]) : "",
        email: iEmail !== -1 ? clean(cols[iEmail]) : "",
        note,
        leadType,
        wantDate: iWantDate !== -1 ? clean(cols[iWantDate]) : "",
        preferredTime: iTime !== -1 ? clean(cols[iTime]) : "",
        urgent,
        urgentReason: urgent ? "Marked emergency on the website form" : "",
      };
    });
}

const DATE_ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
// "Sep 21, 6:10 PM" style — this is the enquiry's own timestamp on some of
// the website's detail pages, not a preferred date. Recognized so it's
// skipped rather than mis-filed as one (it won't cast to a date column).
const DATE_TIMESTAMP_RE = /^[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{1,2}:\d{2}\s*(AM|PM)?$/i;
const TIME_SLOTS = new Set(["morning", "afternoon", "evening"]);
const DOCTOR_LINE_RE = /^(Dr\.?|Prof\.?)\s/i;
const PHONE_LINE_RE = /^\+?[\d ]{7,15}$/;

function isCategoryLine(line: string): LeadType | null {
  const key = line.trim().toLowerCase().replace(/:$/, "");
  return CATEGORY_TO_LEAD_TYPE[key] ?? null;
}

/** The website's "View details" pages copy-paste as unlabeled, multi-line
 * text blocks — no delimiters, and the field that appears at a given line
 * position changes by category (an appointment has a date + time slot and a
 * doctor name at the end; a general inquiry has neither). Records are
 * anchored on a category line ("appointment:", "Surgery:", "General
 * Inquiry" — colon optional, case-insensitive) rather than blank lines,
 * because a blank line can appear *inside* one record (the appointment
 * shape puts the doctor's name after the notes, separated by one). Fields
 * are recognized by shape (phone/email/date/time-slot/doctor pattern)
 * rather than position, since position isn't stable across categories —
 * the only fixed position is facility, which is reliably the line right
 * after the category everywhere it's been seen. */
function parsePastedLeads(text: string): ImportRow[] {
  type Block = { leadType: LeadType; urgent: boolean; lines: string[] };
  const blocks: Block[] = [];
  let current: Block | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const cat = isCategoryLine(line);
    if (cat) {
      if (current) blocks.push(current);
      current = { leadType: cat, urgent: URGENT_CATEGORIES.has(line.toLowerCase().replace(/:$/, "")), lines: [] };
    } else if (current && line) {
      current.lines.push(line);
    }
  }
  if (current) blocks.push(current);

  return blocks
    .filter((b) => b.lines.length >= 2) // at minimum a facility + something identifying
    .map((b) => {
      const facility = clean(b.lines[0]);
      let doctor = "";
      let wantDate = "";
      let preferredTime = "";
      let phone = "";
      let email = "";
      const leftover: string[] = [];

      for (const line of b.lines.slice(1)) {
        if (!phone && PHONE_LINE_RE.test(line)) {
          phone = line;
        } else if (!email && line.includes("@")) {
          email = line;
        } else if (!wantDate && DATE_ISO_RE.test(line)) {
          wantDate = line;
        } else if (DATE_TIMESTAMP_RE.test(line)) {
          // recognized as the enquiry's own timestamp — deliberately dropped
        } else if (!preferredTime && TIME_SLOTS.has(line.toLowerCase())) {
          preferredTime = line;
        } else if (!doctor && DOCTOR_LINE_RE.test(line)) {
          doctor = line;
        } else {
          leftover.push(line);
        }
      }

      const name = leftover.shift() ?? "";
      const note = leftover.join(" — ");

      return {
        name,
        phone,
        facility,
        doctor,
        department: "",
        email,
        note,
        leadType: b.leadType,
        wantDate,
        preferredTime,
        urgent: b.urgent,
        urgentReason: b.urgent ? "Marked emergency on the website form" : "",
      };
    })
    .filter((r) => r.name && r.phone);
}

export function ImportModal({ currentUser, onClose, onImported }: ImportModalProps) {
  const [cohort, setCohort] = useState("");
  const [instructions, setInstructions] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [parseError, setParseError] = useState("");
  const [pasted, setPasted] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const ready = cohort.trim().length > 0;

  async function importRows(rows: ImportRow[], notFoundMessage: string) {
    if (!rows.length) {
      setParseError(notFoundMessage);
      return;
    }
    setParseError("");
    const outcome = await importLeads(rows, cohort.trim(), currentUser.employeeId, currentUser.name, instructions.trim());
    setResult(outcome);
    onImported(outcome, cohort.trim());
  }

  function handleFile(file: File) {
    if (!ready) return;
    file
      .text()
      .then((text) => importRows(parseImportFile(text), "Couldn’t find any rows — check the file has a name and a phone number column."))
      .catch(() => setParseError("Couldn’t read that file."));
  }

  function handlePasteImport() {
    if (!ready || !pasted.trim()) return;
    importRows(
      parsePastedLeads(pasted),
      "Couldn’t find a lead in that text — check it has a category line (e.g. “Appointment:”), a phone number and a name.",
    );
  }

  return (
    <div className={`${styles.overlay} ${styles.center}`}>
      <div className={`${styles.modalCard} ${styles.narrowFixed}`}>
        <div className={styles.modalTitle} style={{ fontSize: 18 }}>
          Import a file
        </div>
        <div className={styles.modalSubtitle} style={{ marginTop: 8, lineHeight: 1.6 }}>
          One row per lead: name, phone, hospital, doctor or department. Every row is checked against existing
          numbers before anything is created — you review the duplicates before they go in.
        </div>

        <label className={styles.field} style={{ marginTop: 18 }}>
          <span className={styles.fieldLabel}>
            Name this batch <span className={styles.required}>— required</span>
          </span>
          <input
            value={cohort}
            onChange={(e) => setCohort(e.target.value)}
            placeholder="e.g. Sep health camp — Uttara"
            className={styles.textInput}
            style={{ borderWidth: 1.5, borderStyle: "solid", borderColor: ready ? "var(--success-tint-border)" : "var(--border-input)" }}
          />
          <span className={styles.hint}>Every row gets this tag, so you can see later how this batch performed against the rest.</span>
        </label>

        <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginTop: 10 }}>
          {RECENT_BATCHES.map((c) => (
            <button key={c} type="button" className={styles.pillBtn} onClick={() => setCohort(c)}>
              {c}
            </button>
          ))}
        </div>

        <label className={styles.field} style={{ marginTop: 14 }}>
          <span className={styles.fieldLabel}>
            Instructions for call agents <span className={styles.muted}>— optional</span>
          </span>
          <textarea
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            rows={2}
            placeholder="e.g. Dr. Shelly's patients — offer the executive check-up, mention her by name"
            className={styles.textarea}
          />
          <span className={styles.hint}>Agents can pull this up from the lead card to refresh their memory on this batch.</span>
        </label>

        <div
          className={`${styles.dropZone} ${ready ? styles.active : ""}`}
          style={{
            borderColor: ready ? "#C9D6DA" : "var(--border)",
            background: ready ? "var(--surface)" : "var(--surface-subtle)",
          }}
          onClick={() => ready && fileInputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            if (ready) setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const file = e.dataTransfer.files?.[0];
            if (file) handleFile(file);
          }}
        >
          <div className={styles.dropTitle} style={{ color: ready ? "var(--ink)" : "var(--ink-disabled)" }}>
            {ready ? (dragOver ? "Drop it" : "Drop the file here") : "Name the batch first"}
          </div>
          <div className={styles.dropSub}>
            {ready ? `CSV or Excel · every row tagged “${cohort.trim()}”` : "The tag is what makes the batch reportable later"}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
              e.target.value = "";
            }}
          />
        </div>

        <label className={styles.field} style={{ marginTop: 14 }}>
          <span className={styles.fieldLabel}>Or paste straight from the website</span>
          <textarea
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            rows={4}
            placeholder={"Copy one or more enquiries from the website's detail page and paste them here — one or many at once"}
            className={styles.textarea}
            disabled={!ready}
          />
          <span className={styles.hint}>Works whether you copy one enquiry or several at a time.</span>
        </label>
        {pasted.trim() && (
          <button
            type="button"
            className={styles.pillBtn}
            style={{ marginTop: 8, opacity: ready ? 1 : 0.6 }}
            disabled={!ready}
            onClick={handlePasteImport}
          >
            Add pasted leads
          </button>
        )}

        {parseError && (
          <div className={styles.duplicateReview} style={{ background: "var(--danger-tint)", borderColor: "var(--danger-tint-border)", color: "var(--danger)" }}>
            {parseError}
          </div>
        )}

        {result && (
          <div className={styles.duplicateReview}>
            {result.created.length} new lead{result.created.length === 1 ? "" : "s"} added, tagged “{cohort.trim()}”.
            {result.duplicates.length > 0 && (
              <>
                {" "}
                {result.duplicates.length} number{result.duplicates.length === 1 ? "" : "s"} already existed and{" "}
                {result.duplicates.length === 1 ? "was" : "were"} skipped:
                <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                  {result.duplicates.map((d, i) => (
                    <li key={i}>
                      {d.row.name} ({d.row.phone}) — already in the system as {d.existing.name}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}

        <div style={{ display: "flex", gap: 9, marginTop: 18, flexWrap: "wrap" }}>
          <div style={{ minWidth: 0, flex: "1 1 auto", fontSize: 13, color: "var(--ink-faint)", alignSelf: "center", lineHeight: 1.5 }}>
            {ready && !result ? "Imported rows go to the call centre in arrival order — not ahead of urgent leads." : ""}
          </div>
          <button type="button" className={styles.btnImport} onClick={onClose} style={{ minHeight: 46, padding: "12px 16px", borderRadius: 7, flex: "0 0 auto" }}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
