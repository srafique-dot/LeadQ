import type { ImportRow } from "../../../api/leads";
import type { LeadType } from "../../../api/types";

/** Website "Interested in" / "Category" text → our lead type. Case-insensitive
 * on the trimmed value. Anything unrecognized falls back to general_inquiry
 * rather than rejecting the row — better an under-tagged lead than a dropped one. */
export const CATEGORY_TO_LEAD_TYPE: Record<string, LeadType> = {
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
  "international patients": "international_patient",
};
export const URGENT_CATEGORIES = new Set(["emergency assistance"]);
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
export function parseImportFile(text: string): ImportRow[] {
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

const DOCTOR_LINE_RE = /^(Dr\.?|Prof\.?)\s/i;
const PHONE_LINE_RE = /^\+?[\d ]{7,15}$/;
// "Sep 20, 2026" — a bare date line, as the site's admin tables render it
// split across lines rather than one delimited row.
const DATE_LINE_RE = /^[A-Za-z]{3,9}\s+\d{1,2},\s*\d{4}$/;
// "12:11 AM" — same table's time-of-day column, also on its own line.
const TIME_LINE_RE = /^\d{1,2}:\d{2}\s*(AM|PM)$/i;
// The inbox tables' row-status word. Sometimes carries the date on the same
// line after a tab ("Read\tSep 9, 2026"), sometimes alone with the date on
// the next line — both forms show up across the site's own tables.
const READ_LINE_RE = /^read(\t|$)/i;
// Whatever the site's "open this enquiry" / "mark as read" link renders as —
// noise to stop a record at, never lead data.
const TERMINAL_ACTION_RE = /^(view( details)?|mark (unread|read)|delete)$/i;

/** A copied table's own header row — "Doctor Name ... Phone ...", "Name
 * Mobile Email ... Actions" — recognized by shape (has a tab, and both a
 * "name" and a "phone"/"mobile" column) rather than by exact wording, since
 * the exact column set differs between the site's own tables. Used only to
 * skip the row and to tell the two table families apart (see parsePastedLeads). */
function isHeaderRow(line: string): boolean {
  return line.includes("\t") && /name/i.test(line) && /(phone|mobile)/i.test(line);
}

/** The hospital's admin site has (so far) two table families, and this
 * parser handles both by reading a whole paste in one pass rather than by
 * splitting on category words — a category word ("Health Packages") is
 * *inside* a record here, not a line that starts one, so anchoring on it
 * (the previous approach) tore the wrong lines into the wrong record.
 *
 * Family 1 — the consultation-booking table (columns: Submitted date+time,
 * Doctor, Department, Facility Code, Facility Name, Preferred Date, Time
 * Slot, Patient Name, Phone, Email, Notes). Copied as one field per line, in
 * that fixed order, so once a phone number is found the rest of its record
 * sits at fixed offsets around it — nine lines back reaches the submitted
 * date, one line forward is the email, two forward the notes.
 *
 * Family 2 — the two enquiry-inbox tables ("general" and "corporate"),
 * anchored by the site's own "Read" / "Read <date>" row-start and ended by
 * its "View" / "View details" (+ "Mark unread") row-end. Between the phone
 * and that end marker sits a short, variable pool of fields — sometimes just
 * one ("Interested in"), sometimes a category plus a separate message — so
 * rather than count them positionally, each pooled line is checked against
 * the category dictionary: a match sets the lead type (and urgent flag),
 * everything else is joined into the note.
 *
 * Which family is active is tracked as we go: a header row containing
 * "Doctor" switches to the consultation table, any other header row or a
 * "Read" line switches to the inbox family — so pasting several tables
 * together (a full day's export) parses each with its own rule. */
export function parsePastedLeads(text: string): ImportRow[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const at = (i: number): string => lines[i] ?? "";

  type Mode = "consultation" | "inbox";
  let mode: Mode = "inbox";
  const rows: ImportRow[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    if (isHeaderRow(line)) {
      mode = /doctor/i.test(line) ? "consultation" : "inbox";
      continue;
    }
    if (READ_LINE_RE.test(line)) {
      mode = "inbox";
      continue;
    }
    if (!PHONE_LINE_RE.test(line)) continue;

    if (mode === "consultation") {
      const patientName = at(i - 1);
      const doctorLine = at(i - 7);
      const looksRight = patientName && !PHONE_LINE_RE.test(patientName) && !DATE_LINE_RE.test(patientName) && DOCTOR_LINE_RE.test(doctorLine);
      if (looksRight) {
        const email = at(i + 1).includes("@") ? at(i + 1) : "";
        rows.push({
          name: patientName,
          phone: line,
          facility: clean(at(i - 4)),
          doctor: clean(doctorLine),
          department: clean(at(i - 6)),
          email,
          note: clean(at(i + 2)),
          leadType: "appointment",
          wantDate: clean(at(i - 3)),
          preferredTime: clean(at(i - 2)),
          urgent: false,
          urgentReason: "",
        });
        continue;
      }
      // Didn't match the expected shape (a reordered/shortened export) —
      // fall through and read it as a plain inbox record instead of
      // dropping it.
    }

    // Name sits immediately before the phone in every table seen so far;
    // the short backward scan is only a cushion against a stray blank line.
    let name = "";
    for (let b = i - 1; b >= Math.max(0, i - 3); b--) {
      const cand = at(b);
      if (!cand) continue;
      if (READ_LINE_RE.test(cand) || DATE_LINE_RE.test(cand) || TIME_LINE_RE.test(cand) || PHONE_LINE_RE.test(cand)) break;
      name = cand;
      break;
    }
    if (!name) continue;

    // The line right after the phone is always the email slot, even when
    // the site shows it blank ("—") — so it's consumed either way to keep
    // the field count aligned for whatever comes next.
    let email = "";
    let cursor = i + 1;
    if (at(cursor).includes("@")) email = at(cursor);
    cursor++;

    const detail: string[] = [];
    for (let f = cursor; f < lines.length && f < cursor + 12; f++) {
      const cand = at(f);
      if (!cand) continue;
      if (READ_LINE_RE.test(cand) || TERMINAL_ACTION_RE.test(cand) || PHONE_LINE_RE.test(cand) || isHeaderRow(cand)) break;
      detail.push(cand);
    }

    let leadType: LeadType = "general_inquiry";
    let urgent = false;
    const noteParts: string[] = [];
    for (const d of detail) {
      const cleaned = clean(d);
      if (!cleaned) continue;
      const key = cleaned.toLowerCase().replace(/:$/, "");
      const mapped = CATEGORY_TO_LEAD_TYPE[key];
      if (mapped) {
        leadType = mapped;
        if (URGENT_CATEGORIES.has(key)) urgent = true;
      } else {
        noteParts.push(cleaned);
      }
    }

    rows.push({
      name,
      phone: line,
      facility: "",
      doctor: "",
      department: "",
      email,
      note: noteParts.join(" — "),
      leadType,
      wantDate: "",
      preferredTime: "",
      urgent,
      urgentReason: urgent ? "Marked emergency on the website form" : "",
    });
  }

  return rows.filter((r) => r.name && r.phone);
}
