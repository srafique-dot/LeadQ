/**
 * Regression test for the website paste importer (src/screens/Requester/
 * components/importParsers.ts), run against synthetic fixtures modeled on
 * the hospital site's three real export shapes (a consultation-booking
 * table and two Read/View-anchored enquiry inboxes). Names, phones and
 * emails below are fabricated — never commit real patient data as a
 * fixture — but the line-by-line structure (tabs, dash placeholders,
 * multi-line messages, a truncated trailing record, a duplicate submission)
 * matches real pastes byte-for-byte in shape.
 *
 * No database needed — this is a pure-function test. Run with:
 *   npx tsx scripts/paste-import-test.ts
 */
import { parsePastedLeads } from "../src/screens/Requester/components/importParsers";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

// --- Fixture 1: consultation-booking table -------------------------------
// Columns: Submitted (date+time, split across 2 lines), Doctor, Department,
// Facility Code, Facility Name, Preferred Date, Time Slot, Patient Name,
// Phone, Email, Notes. The trailing record is cut off mid-copy (no phone),
// which is how the real export sometimes arrives when someone copies past
// the visible screen.
const CONSULTATION = `Submitted (GMT+6)\tDoctor Name\tDepartment\tFacility Code\tFacility Name\tPreferred Date\tTime Slot\tPatient Name\tPhone\tEmail\tNotes
Sep 20, 2026
4:07 PM
Prof. Dr. Fake Doctor One
Obs & Gynae
UMCH
United Medical College Hospital
2026-09-20
Evening
Test Patient One
01700000001
patient.one@example.com
Pregnancy
Sep 20, 2026
2:59 PM
Dr. Fake Doctor Two
Urology
UMCH
United Medical College Hospital
2026-09-20
Afternoon
Test Patient Two
01700000002
patient.two@example.com
—
Sep 20, 2026
10:22 AM
Dr. Fake Doctor Three
Clinical & Interventional Pulmonology
UMCH
United Medical College Hospital
2026-09-20
Morning
Test Patient Three
01700000003
patient.three@example.com
বুকের ঠিক নিচে ব্যাথা হয়
Sep 19, 2026
11:02 PM
Dr. Fake Doctor Four
Physical Medicine & Rehabilitation`;

// --- Fixture 2: "other forms" enquiry inbox -------------------------------
// Read-anchored, 4 fields between email and "View" (subject, category, a
// placeholder dash, message) — sometimes with the message present, some-
// times both trailing fields are dashes, and once with a message long
// enough to exercise the multi-line detail cap.
const OTHER_FORMS = `other forms
Read\t
Sep 1, 2026
12:11 AM
Fatima Test One
01700000010
fatima.one@example.com
full body checkup
Health Packages
—
i want a full body checkup, please send details
View
Read\t
Aug 31, 2026
1:58 PM
Karim Test Two
01700000011
karim.two@example.com
—
Health Packages
—
Need to check diabetes
View
Read\t
Aug 30, 2026
8:16 AM
Salma Test Three
+447000000012
salma.three@example.com
Stent
Surgery Packages
—
—
View
Read\t
Aug 27, 2026
8:59 AM
Rashed Test Four
+12000000013
rashed.four@example.com
IVIG Infusion
International patients
—
I will visit BD in October. Please advise the following:
1- do you administer IVIG infusion
2- I need infusion on two consecutive days
3- please confirm availability of the brand we use
4- price and cost for the treatment
Call me back at your convenience. Thanks.
View`;

// --- Fixture 3: "corporate lead form" enquiry inbox -----------------------
// Read-anchored like fixture 2, but the date rides on the same line as
// "Read" (tab-joined), only 2 fields between email and the action links,
// and 2 action lines ("View details" + "Mark unread") instead of 1. Also
// has a real duplicate submission, same as the live site sometimes shows.
const CORPORATE = `corporate lead form
Status\tReceived\tName\tMobile\tEmail\tInterested in\tMessage\tActions
Read\tSep 9, 2026
7:33 PM\t
General Test One
+8801700000020
—
General Inquiry
—
View details
Mark unread
Read\tSep 2, 2026
12:43 PM\t
Booking Test Two
01700000021
booking.two@example.com
Booking an Appointment
—
View details
Mark unread
Read\tAug 28, 2026
2:18 PM\t
Urgent Test Three
01700000022
—
Emergency Assistance
Need information regarding a scan, its urgent
View details
Mark unread
Read\tAug 27, 2026
2:13 PM\t
Duplicate Test Four
01700000023
—
Booking an Appointment
—
View details
Mark unread
Read\tAug 27, 2026
2:13 PM\t
Duplicate Test Four
01700000023
—
Booking an Appointment
—
View details
Mark unread`;

function main() {
  console.log("\nConsultation-booking table");
  const c = parsePastedLeads(CONSULTATION);
  check("3 complete records parsed, the cut-off trailing one dropped", c.length === 3, String(c.length));
  check("name/phone/email paired correctly", c[0]?.name === "Test Patient One" && c[0]?.phone === "01700000001" && c[0]?.email === "patient.one@example.com");
  check("doctor, department, facility all captured", c[0]?.doctor === "Prof. Dr. Fake Doctor One" && c[0]?.department === "Obs & Gynae" && c[0]?.facility === "United Medical College Hospital");
  check("preferred date and time slot captured", c[0]?.wantDate === "2026-09-20" && c[0]?.preferredTime === "Evening");
  check("notes captured when present", c[0]?.note === "Pregnancy");
  check("a dash placeholder note comes through blank, not literally '—'", c[1]?.note === "");
  check("every record is tagged as an appointment", c.every((r) => r.leadType === "appointment"));
  check("non-English (Bangla) note text survives untouched", c[2]?.note === "বুকের ঠিক নিচে ব্যাথা হয়");

  console.log("\n\"Other forms\" enquiry inbox (subject + category + message)");
  const o = parsePastedLeads(OTHER_FORMS);
  check("4 records parsed", o.length === 4, String(o.length));
  check("name/phone/email paired correctly, not shifted by a record", o[0]?.name === "Fatima Test One" && o[0]?.phone === "01700000010" && o[0]?.email === "fatima.one@example.com");
  check("category recognized from the pool and note built from the rest", o[0]?.leadType === "health_package" && o[0]?.note === "full body checkup — i want a full body checkup, please send details");
  check("second record's own name/phone/email, not leaked from the first", o[1]?.name === "Karim Test Two" && o[1]?.phone === "01700000011");
  check("a blank subject ('—') doesn't pollute the note", o[1]?.note === "Need to check diabetes");
  check("both trailing fields blank leaves an empty note, category still set", o[2]?.leadType === "surgery_package" && o[2]?.note === "Stent");
  check("a 5-line message is captured in full, not truncated", (o[3]?.note.match(/\n| — /g)?.length ?? 0) >= 4 && o[3]?.note.includes("Call me back at your convenience. Thanks."));
  check("plural category variant maps correctly", o[3]?.leadType === "international_patient");

  console.log("\n\"Corporate lead form\" enquiry inbox (Read+date on one line, 2 action lines)");
  const p = parsePastedLeads(CORPORATE);
  check("5 records parsed (including the duplicate submission)", p.length === 5, String(p.length));
  check("name/phone paired correctly when email is a dash placeholder", p[0]?.name === "General Test One" && p[0]?.phone === "+8801700000020" && p[0]?.email === "");
  check("email captured when present", p[1]?.email === "booking.two@example.com");
  check("'Booking an Appointment' maps to appointment", p[1]?.leadType === "appointment");
  check("'Emergency Assistance' is flagged urgent with its message kept", p[2]?.urgent === true && p[2]?.note.includes("its urgent"));
  check("the duplicate submission still parses as two separate rows (dedupe happens downstream)", p[3]?.phone === "01700000023" && p[4]?.phone === "01700000023");

  console.log("\nMultiple tables pasted together");
  const all = parsePastedLeads([CONSULTATION, OTHER_FORMS, CORPORATE].join("\n\n"));
  check("each table's row count adds up with none lost or duplicated across the boundary", all.length === c.length + o.length + p.length, String(all.length));

  console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) FAILED.`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
