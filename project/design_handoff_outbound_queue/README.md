# Handoff: UMCH Outbound Queue Management

## Overview

A routing and call-outcome logging layer that sits between lead ingestion (Meta lead ads, Google lead forms, website landing pages, walk-in referrals, bulk imports) and the UMCH call centre. It replaces the current practice of tracking leads in WhatsApp groups.

The system does five things:

1. **Captures a lead** — from a requester (business development, marketing, front desk) on desktop or phone, or from a bulk file import.
2. **Catches duplicates** — on phone number, at the moment of entry, before a second card exists.
3. **Routes it to an agent** — arrival order, with urgent leads jumping ahead.
4. **Forces an outcome to be logged** — a two-level disposition with rules that block a save when required steps are missing.
5. **Lets a team lead watch the floor and review the month.**

Booking, payment and patient records live in the existing ERP. This system records the *call*, not the appointment. Do not build booking or payment screens.

**Phase 1 is leads only.** CRM and retention workflows were explicitly deferred to phase 2 — no schema or UI work for them.

## About the Design Files

The files in `designs/` are **design references created in HTML**. They are prototypes that show intended look, copy and behaviour. They are **not production code to copy**.

Each `.dc.html` file is a self-contained page: a markup template plus a small logic class, rendered by `designs/support.js`, styled entirely with inline styles. There is no build step, no npm dependency, and the data is hard-coded mock data inside each file.

The task is to **recreate these designs in the target codebase's existing environment** — React, Vue, Blade, Livewire, SwiftUI, whatever the app already uses — following that codebase's established patterns, component library, routing and data layer. If no environment exists yet, pick the framework most appropriate for the team and implement there.

Read each HTML file alongside this README: the README carries the rules and reasoning, the HTML carries the exact copy, colours and spacing.

## Fidelity

**High-fidelity.** Final colours, typography, spacing, copy, validation rules and interaction states. Recreate the UI faithfully using the codebase's own components where equivalents exist. Where this README states an exact hex value or pixel size, it is deliberate.

Two things are intentionally *not* final:
- All data is mock data. Field names in the mocks are illustrative, not a schema contract.
- Layout is fluid, not pixel-locked. Breakpoint behaviour is described per screen.

## Roles

| Role | Sees | Notes |
|---|---|---|
| `requester` | Own leads, add a lead, bulk import | Business development, marketing, front desk. Mobile use is common. |
| `agent` | The call queue, one lead at a time, disposition form | Desktop primary; phone is a nice-to-have, not required. |
| `admin` | Floor view, monthly report, all leads | Team lead. Cannot change passwords. |
| `superadmin` | Everything, plus create accounts and reset passwords | The only role that can reset a password. |

## Screens / Views

### 1. Sign in — `designs/Outbound Queue - Sign in.dc.html`

**Purpose:** Get a shift started in as few taps as possible. Employee ID and password only — there is no email address in this system and no self-service password recovery.

**Layout:** Single centred column, `max-width: 420px`. Page padding `48px 24px` on desktop; on narrow (<560px) the column top-aligns and padding drops to `24px 16px 40px`. Card: white, `1px solid #E2E9EB`, `border-radius: 12px`, padding `26px 24px` (desktop) / `22px 18px` (narrow). UMCH logo 26px tall sits above the card with the label "Outbound queue" at 14px `#5D7178`.

**Three stages in one screen:**

**a. Sign in.**
- *Remembered device* (default state): heading "Welcome back, {firstName}", sub "Just your password — this computer remembers who you are" ("phone" when narrow). A grey identity strip (`#F4F7F8`, `1px solid #E2E9EB`, radius 9px, padding `14px 16px`) shows a 34px teal avatar circle with initials, the name at 15px/600, and `{employeeId} · {role}` in 12.5px mono `#7A8B91`. A borderless "Not me" link at the right clears the remembered ID and reveals the ID field.
- *Unrecognised device*: heading "Sign in", sub "Use the employee ID your team lead gave you. There is no email address to remember." Employee ID field is 22px IBM Plex Mono, `text-transform: uppercase`, `min-height: 56px`, placeholder `CC-002`, `autoComplete="username"`.
- Password field: 18px mono, `min-height: 56px`, `autoComplete="current-password"`, with a Show/Hide button beside it (white, `1px solid #DCE4E7`, same height).
- "Stay signed in on this computer/phone" — custom 22px checkbox, checked by default (teal `#0E7C86` fill, white ✓). This is the single biggest convenience decision: a shift start should be one tap.
- Primary button full width, `min-height: 56px`, 16.5px/700, label flips to "Signing in…" with background `#0A5C64` while busy (mock delay 420ms).
- Footer note above a `1px solid #EDF2F3` divider: "Forgotten it? A superadmin resets it for you — there is no email link. Ask your team lead."
- Errors render in a `#FDF5F4` box with `1px solid #F0CFCA`, text `#9C3B31` 13.5px/500, and the offending field's border turns `#E0B4AF`. Distinct messages: empty ID, unknown ID ("No account with that employee ID. Check it with your team lead."), empty password, wrong password ("That password does not match. A superadmin can reset it for you."). Never reveal whether an ID exists in a way that leaks staff lists beyond what the roster already gives.

**b. Forced first-time password change.** Triggered when the account has never signed in (`mustSet`). Amber pill "First time signing in", heading "Pick your own password", sub explaining the issued password stops working and that nobody — not even a superadmin — can read the new one back. New password field, strength bar (5 states: Too short/Weak/Fine/Good/Strong; colours `#9C3B31`, `#9C3B31`, `#9A6206`, `#0E7C86`, `#1B7A4B`), confirm field, one Show/Hide toggle for both. Blockers, in order: under 8 characters; identical to the issued password; confirm empty; confirm mismatch. Button "Save it and start work".

**c. Signed in.** Green ✓ disc, "You are in, {firstName}", role and ID, whether the device will remember them, and a grey box naming the next screen. In production this stage is a redirect — it exists in the mock only to make the routing decision visible. Route by role: requester → own leads; agent → call queue; admin → floor view; superadmin → people & access.

**Mock accounts:** `CC-002 / queue123` (straight in), `CC-009 / Kf7-r2mq` (forced change), plus `BD-007`, `OP-001`, `IT-001` on `queue123`.

**Password rules to implement:** minimum 8 characters; must differ from the issued one; hashed one-way (the UI promises nobody can read it back — honour that); force change on first sign-in and after any superadmin reset.

---

### 2. Requester — lead intake — `designs/Outbound Queue - Requester.dc.html`

**Purpose:** A requester adds a lead in under a minute, on a phone if necessary, and can see what the call centre did with it. They never see the calling itself.

**Layout:** Header bar (white, `1px solid #E2E9EB` bottom, padding `14px 28px`, logo + "Lead intake" + the signed-in user at the right). Body `max-width: 900px`, padding `26px 28px 48px`. Below 640px: header padding `12px 16px`, body padding `18px 16px 40px`, and the two header buttons go full width, stacked, `min-height: 46px`.

**Stat strip:** `repeat(auto-fit, minmax(150px, 1fr))`, gap 10px. Cards white, `1px solid #E2E9EB`, radius 9px, padding `15px 17px`; number 26px IBM Plex Mono/600, label 12.5px `#5D7178`. Five stats: added by you today (`#16232A`), booked (`#1B7A4B`), still being called (`#0E7C86`), marked urgent (`#9C3B31`), duplicates caught (`#9A6206`).

**Lead list:** White card, radius 10px. Header row with "Submitted by you" and four filter pills (All / Open / Booked / Closed) — active pill is teal-filled white text, inactive is white with `1px solid #DCE4E7` and `#5D7178` text, radius 16px, padding `6px 13px`. Each row: name 16px/600, then badges — `URGENT` (`#FBE9E7` on `#9C3B31`), cohort tag (`#EDEBF6` on `#4A3E8F`), `MERGED` (`#FDF0CE` on `#7E5F12`), all 10.5px/700 with `letter-spacing: .06em`, radius 3px. Below: phone in 13.5px mono `#5D7178`, then `{doctor or department} · {facility}` in 13px `#7A8B91`. Right side: a status pill with a 7px dot plus a detail line.

**Status vocabulary** (pill background / border / text / dot):
- `waiting` "Waiting for a call" — `#FDF9EE` / `#EBDCB4` / `#7A4E06` / `#9A6206`
- `trying` "Being called" — `#E7F1F2` / `#C5DEE0` / `#0A5C64` / `#0E7C86`
- `booked` "Booked" — `#E9F6F1` / `#B7E0D0` / `#125C3D` / `#1B7A4B`
- `closed` "Closed" — `#FDF5F4` / `#F0CFCA` / `#9C3B31` / `#9C3B31`

Footer note: "Booking and payment live in the ERP. This list shows the call outcome only."

**Add-a-lead modal.** Overlay `rgba(15,28,34,.55)`, card `max-width: 620px`, radius 12px, top-aligned with `44px 20px` padding. **Below 640px it becomes a full-bleed sheet:** overlay padding 0, `align-items: stretch`, card radius 0, `max-width: none`, `min-height: 100%`. Field order matters — it follows the order information arrives in a phone call:

1. **Phone number** — 20px mono input, the visual anchor of the form. Duplicate checking runs as you type. Under 7 digits: "Keep typing — we check for duplicates as you go." 7+ digits, no match: "New number — no existing lead." (`#125C3D`), border `#B7E0D0`. Match found: border `#E0C98F` and the duplicate block appears.
2. **Duplicate block** (conditional) — amber card (`#FDF9EE`, `1px solid #EBDCB4`) headed "This number is already in the system", showing the existing lead's name, phone, doctor/facility, status and owner, then a forced two-way choice: "Same person — add to that lead" or "Different person — create separate". Save is blocked until one is picked. This is the core of the duplicate strategy: catch it at entry, make a human decide, never silently merge.
3. **Name** — the caller's name, as they gave it.
4. **Which hospital** (select: UMCH Main, Medix Uttara, MA Rashid Clinic) and **Area** side by side, `minmax(210px, 1fr)`.
5. **Which doctor did they ask for** (free text, autocomplete from the ERP doctor list in production) and **Department — if no doctor named** side by side. At least one of the two is required. This is deliberate: the WhatsApp logs show almost every real lead names a specific doctor, and a free-text "what do they need" field loses that.
6. **Which day do they want — optional**, native date input, `max-width: 220px`. Note when empty: "Leave it empty if they did not say — you can add it later."
7. **Urgent block** — a bordered panel, `#EDF2F3` border and white when off, `#F0CFCA` border on `#FDF5F4` when on. 22px checkbox, label "Call this one first", sub "VIP, referred by a doctor, or genuinely time-critical. It jumps ahead of everything waiting." When checked, a **required** "Why" field appears: "The agent sees this reason and your name on it. Team leads review how often urgent gets used." Attribution is the control that stops urgent being overused — keep it.
8. **"This booking is for someone else"** — a text toggle that reveals a required patient name field: "The agent calls the number above, but books under this name." Real logs show the caller and the patient are frequently different people.
9. **What they said — optional** textarea, 2 rows.

**Save blockers, evaluated in this order, one shown at a time** in the footer beside the button:
1. "Write the caller's name."
2. "Write the full phone number." (10 digits)
3. "This number already exists — choose one of the two options above."
4. "Choose which hospital."
5. "Write the doctor they asked for, or the department if they did not name one."
6. "Write the patient's name." (when booking for someone else)
7. "Say why this one jumps the queue." (when urgent)

Disabled button is `#B4C2C6` at `.75` opacity; enabled `#0E7C86`. When clear, the footer explains the consequence instead: "Goes to the call centre with a 5 minute call target", or "Goes to the front of the queue — the next free agent gets it" when urgent, or "Adds this enquiry to {name} — no new card for the agent" when merging. Button label switches to "Add to existing lead" in merge mode.

On save, a green confirmation banner appears on the list, always naming the actor: "{name} is in the queue · created by BD-007 Ishrat Sultana", or the urgent/merge variants.

**Import modal.** `max-width: 480px`. **A batch name is required before the drop zone activates** — this was a late but important addition: without a cohort tag, campaign performance can never be compared afterwards. Field "Name this batch — required", plus three recent-batch shortcut pills. The drop zone reads "Name the batch first" (border `#E2E9EB`, background `#FAFCFC`, text `#9AA9AE`) until a name exists, then "Drop the file here" with "CSV or Excel · every row tagged '{batch}'". Note when ready: "Imported rows go to the call centre in arrival order — not ahead of urgent leads." Expected columns: name, phone, hospital, doctor or department. Every row is duplicate-checked against existing numbers and the requester reviews the duplicates before anything is created.

**Still missing from this screen** (see Open Decisions): a lead detail view where a requester amends a requested date they did not have at intake.

---

### 3. Agent call flow — `designs/Outbound Queue - Agent Flow v2.dc.html`

**Purpose:** One lead at a time. Read the brief, place the call from the phone system, log what happened. Desktop primary.

This is the most rule-dense screen. Read the file for exact markup; the rules below are the contract.

**Brief (top card).** Order of prominence, top to bottom:
1. **Urgent banner** (conditional) — `#FDF5F4` on `1px solid #F0CFCA`, a solid `#9C3B31` `URGENT` chip, "Call this one first", the reason at 14.5px, and "Marked urgent by {requester name and ID}".
2. **Merged-lead banner** (conditional) — amber; "Same phone number came in {n} times — treated as one lead", each entry listed with channel and time, and "One call covers both. Your outcome closes every entry on this number." Includes a "Not the same person" split action.
3. **"They asked for"** label, then the **doctor** as the 22px headline (falls back to department, then service).
4. Chips: "Wants {date}" (`#E7F1F2`/`#0A5C64`), "Booking is for {patient} — not the person you are calling" (`#FDF0CE`/`#7E5F12`), cohort tag (`#EDEBF6`/`#4A3E8F`).
5. One grey line with the ingestion detail, then the lead's own words in a teal-left-bordered quote block.
6. **The phone number** as a 29px mono copy-to-clipboard button, and a green "The call is finished" button. Helper: "Copy the number, call from the call center panel, then come back and press the green button." The dialler is the existing phone system — this screen does not place calls.

A 4-segment progress bar shows "Call {n} of 4". Outside calling hours, an amber strip reads "Outside the calling window — VIP and emergency only."

**Disposition form.** Two levels.

*Level 1 — what happened on the call:* `connected`, `not_responding` (no answer), `busy`, `number_off`, `invalid_number`, `call_rejected`.

*Level 2 — only when connected:* `appointment_purchased` (booked and paid, win), `appointment_booked` (booked, not paid, win), `info_given` (will decide later, open), `callback_later` (open), `ni_price`, `ni_distance`, `ni_elsewhere` (lost), `wrong_person`, `duplicate`.

Each level-2 code offers 2–3 one-tap quick notes (e.g. `callback_later` → "At work — call after 7 PM", "Travelling this week", "Call tomorrow morning").

*Terminal codes* (close the lead): `appointment_purchased`, `appointment_booked`, `ni_price`, `ni_distance`, `ni_elsewhere`, `wrong_person`, `duplicate`.
*Failed codes* (requeue if attempts remain): `not_responding`, `busy`, `number_off`, `call_rejected`.

**Save blockers:**
1. "Pick what happened on the call."
2. "Pick what they said." (when level 1 is `connected`)
3. "Write a short note — required when they are not interested." (any `ni_*`, minimum 4 characters)
4. "Choose when to call again." (`callback_later` without a date)
5. "Send the SMS first — this is call 3." (**attempt 3+ with a failed code requires the missed-call SMS to be sent before the outcome can be saved**)

**Consequence line** next to the save button: requeue shows the actual return time ("Goes to the back of the queue — comes back around 14:32"); attempt 4 with a failed code shows "Call 4 of 4 — this closes the lead."; otherwise "Saves and opens your next lead."

Callback scheduling offers chips (Later today / Tomorrow / In 2 days / Next week) plus a date input. Earlier calls are listed with attempt number, date, agent and note. Agents can also log an inbound callback and create a lead from this screen (same duplicate logic as intake).

**Attempt policy:** 4 attempts, then the lead closes. The missed-call SMS is mandatory at attempt 3.

---

### 4. Supervisor / team lead — `designs/Outbound Queue - Supervisor.dc.html`

**Purpose:** Watch the floor now; review the month once the phone system's call records are in. The two are separated on purpose, because they come from different sources with different trustworthiness.

Two tabs in a white bar under the header: **Live floor** and **Monthly report**. Below 1000px everything stacks and the wide tables become cards.

#### Live floor — app data only

This tab shows **only what the application itself knows**: queue state and what agents have typed. It deliberately contains no call durations and no dial counts, because the app cannot observe the phone system in real time.

- **Tiles** (`repeat(auto-fit, minmax(160px, 1fr))`, 2 columns on narrow): leads waiting + oldest wait (border and number turn red above 10 waiting), agents with a lead open out of those signed in, leads worked today, outcomes logged, booked with a percentage, and leads past the first-call target (red).
- **Agents signed in.** State pill with a 6px dot and a live `mm:ss` timer: `Lead open` (teal), `Logging outcome` (violet `#4A3E8F`), `No lead open` (green, no timer), `Nothing logged` (amber), `Signed out` (grey). Then the lead they have open, a context line, and three counters: leads today, outcomes, booked. Actions: **Message** (appears on the agent's screen without interrupting anything) and **Move lead**. A footnote states the honest limitation: "'Lead open' means the agent opened the brief and has not logged an outcome yet. It is not proof a call is connected."
- **Needs you now.** Each item has a dot, title, age, detail and one action that logs against the supervisor: leads past the target, an agent on attempt 3 without the required SMS, a late promised callback, an agent who has logged nothing for 8 minutes. Empty state: "Nothing breaching. The queue is inside target."
- **Callbacks due next hour.** Time in mono (red when overdue), name, reason and owning agent.
- **Logged today, by agent.** Columns: leads worked, outcomes, booked, book %, no answer, with a booked bar per agent and a team total row. Book % under 20 turns red.
- **Move lead sheet.** Explains the consequence honestly by state: for a lead currently open, "She has this lead open and may be on the phone right now. The lead transfers as soon as she logs an outcome — nothing is cut off." Otherwise the lead returns to the queue immediately. Attempt count always carries over. Target list is limited to free/quiet agents. Confirmation names both agents and records the move on the lead with the supervisor's name.

#### Monthly report — CDR-driven

Talk time and dial counts come from a **monthly outbound CDR export from the phone system**, uploaded by hand. Nothing on this tab is real-time.

- **Month selector**, then either an upload state or a report.
- **Upload state** (month with no file): dashed panel — "No call record file for {month} yet", with the required columns named: agent extension, number dialled, start time, duration, connected or not. Below it, a "What this system knows for {month}" strip from queue data alone (leads received, outcomes logged, booked, median wait to first call) so the month is never blank.
- **Report state**: file card (name, record count, date range, who uploaded it and when) with a Replace file action — "A new file replaces the month entirely. Nothing agents logged is overwritten." Tiles: calls dialled, connect %, total talk time, average call length, booked, and calls with no outcome logged (red). Per-agent table: calls dialled, connected, connect %, talk time, average call, booked. Connect % under 50 turns red.
- **Calls dialled vs outcomes logged** — the reconciliation that only exists because the two sources are joined, and the most operationally useful thing on the screen. Amber-headed panel: "{n} connected calls in the file have no matching outcome in the queue. Either the agent called from their own phone, or they did not log it." Then a per-agent gap list. This is the lever against off-system calling and non-logging.

**Data integrity rule:** one CDR row is one dialled call, so the file's record count and the sum of per-agent dials must agree. Validate this on upload and refuse a file that contradicts itself.

**Matching rule:** the CDR contains no names — only the extension or number that placed the call. Match on the calling number recorded against each user (see below). Never match on name.

---

### 5. People & access (admin) — `designs/Outbound Queue - Users.dc.html`

**Purpose:** Superadmin creates accounts, sets what someone can do, records the number they call from, and resets passwords.

- **Stats:** active accounts, call centre agents, never signed in (amber), **agents with no calling number** (red — these agents cannot be matched to the CDR), access removed.
- **Account list** with filters (Everyone / Requesters & agents / Admins / No access). Each row: name, a role tag chip, an optional `NO ACCESS` chip, employee ID in mono, and a meta line combining role label, hospital, "calls from {number}" or "no calling number set", and last activity. Deactivated rows render at `.6` opacity. Actions (superadmin only): **Reset password**, **Remove access** / **Restore access**.
- Role tag colours: requester `#E7F1F2`/`#0A5C64`, agent `#EDEBF6`/`#4A3E8F`, admin `#FDF9EE`/`#7A4E06`, superadmin `#E9F6F1`/`#125C3D`.
- **Non-superadmins see the list read-only** — the action buttons disappear and an explanatory card appears. Enforce this server-side, not just in the UI.
- **Add a person:** employee ID (validated `^[A-Za-z]{2}-\d{3}$`, checked for uniqueness live, with Available / Already taken / format messages), full name, role as four descriptive cards, hospital (including "All sites"), **the number they call from** (required for agents, optional otherwise — "Desk extension, or their mobile if they dial from their own phone. The monthly call file has no names in it — this is what ties a call to this person."), and a generated first password shown once with a Generate-another action.
- **Password generation:** unambiguous alphabet (no I/l/1/O/0), starts with a capital and a digit, hyphen inserted for readability, default length 8. Shown once, never retrievable.
- **Reset password:** two steps. Confirm ("Their current password stops working immediately and a new one is generated", attributed to the acting superadmin), then the new password shown once with "Shown once. Their old password stopped working just now." The reset sets the account back to must-change-on-next-sign-in.
- **Remove access** never deletes history: "They can no longer sign in. Their logged calls stay on record."

## Interactions & Behavior

- **No animations** beyond a single pulsing live dot on the supervisor header (`@keyframes`, 1.8s ease-in-out, opacity 1 → .25) and a 420ms simulated sign-in delay. Motion is not part of this design.
- **Hover states** are not specified per element; apply the codebase's conventions. Only pressed/selected states are specified, and they matter — selection is communicated by a teal fill or a teal 1.5px border, never by shadow alone.
- **Validation is blocking, single-message and ordered.** Never show a wall of errors: compute the first unmet condition and show that one sentence beside the disabled button. This pattern is used identically on all four forms and should be implemented once.
- **Every consequential action states its consequence before it happens** and is attributed to the actor afterwards. This is the spine of the whole design — the system exists to create accountability that WhatsApp could not.
- **Responsive behaviour:** each screen measures its own width and swaps layout at one breakpoint — requester 640px, sign-in 560px, supervisor 1000px. Below the breakpoint: modals become full-bleed sheets, buttons go full width at 44–48px minimum height, multi-column tables become stacked cards, and grids collapse to one or two columns. In the target framework use CSS media queries or container queries rather than JS measurement — the mocks measure in JS only because they use inline styles.
- **Touch targets are never below 44px** on any control a phone user reaches.

## State Management

Per screen, the state that actually drives behaviour:

- **Sign in:** stage (`signin` / `change` / `done`), employee ID, password, show-password, stay-signed-in, error, remembered ID (persisted per device), new password, confirm.
- **Requester:** filter, modal open flags, duplicate-resolution mode (`null` / `merge` / `separate`), the entry form object, urgent flag and reason, batch name, lead rows.
- **Agent:** current lead, level-1 code, level-2 code, notes, quick-note selections, callback date, SMS-sent flag, attempt number, merged-entry split state, inbound-callback logged flag.
- **Supervisor:** tab, live tick (1s interval for the timers), agent filter, selected month, uploaded-month map, resolved alert keys, move-lead target.
- **Users:** filter, people list, add-form object, generated password, reset target and stage.

**Data the backend must provide:** lead with caller and patient names, phone, hospital, area, doctor, department, requested date, urgent flag + reason + requester, cohort tag, ingestion channel and campaign, attempt count, status, owning agent, full outcome history; user with employee ID, name, role, hospital, calling number, must-change-password flag, active flag, last activity; monthly CDR rows joined to agents by calling number.

## Design Tokens

**Colour**

| Purpose | Hex |
|---|---|
| Page background | `#F4F7F8` |
| Surface | `#FFFFFF` |
| Subtle surface | `#FAFCFC` |
| Ink | `#16232A` |
| Ink, secondary | `#2C3B42` |
| Ink, muted | `#5D7178` |
| Ink, faint | `#7A8B91` |
| Ink, disabled | `#9AA9AE` |
| Border | `#E2E9EB` |
| Border, light | `#EDF2F3` / `#F3F7F7` |
| Border, input | `#DCE4E7` |
| Primary (teal) | `#0E7C86` |
| Primary, dark | `#0A5C64` |
| Primary tint / border | `#E7F1F2` / `#C5DEE0` |
| Success | `#1B7A4B` |
| Success, dark | `#125C3D` |
| Success tint / border | `#E9F6F1` / `#B7E0D0` |
| Warning | `#9A6206` |
| Warning, dark | `#7A4E06` |
| Warning tint / border | `#FDF9EE` / `#EBDCB4` |
| Danger | `#9C3B31` |
| Danger tint / border | `#FDF5F4` / `#F0CFCA` |
| Violet (agent state, cohort) | `#4A3E8F` on `#EDEBF6` |
| Disabled button | `#B4C2C6` |

Two background colours only (`#F4F7F8` page, white surface). Amber means "needs attention", red means "broken or blocking", green means "done", teal means "in progress or actionable". Do not add a fifth semantic colour.

**Typography** — IBM Plex Sans (400/500/600/700) for everything, IBM Plex Mono (400/500/600) for phone numbers, employee IDs, extensions, times, and every metric. The mono/sans split is meaningful: mono means "a value you might read aloud or copy".

Scale in use: 26px/600 page titles (`letter-spacing: -.015em`), 23px/600 auth headings, 22px/600 the doctor headline and mono metrics, 19px/600 modal titles, 16.5–15.5px/700 primary buttons, 16px/600 row names, 15px/500–600 body emphasis, 14.5px/600 card headers, 14px/600 field labels, 13.5px body, 13px secondary, 12.5px meta, 11.5–12px/700 uppercase table headers with `letter-spacing: .06em`, 10.5px/700 badges with `letter-spacing: .06em`.

**Spacing** — 4px base. Common: 3, 5, 6, 7, 9, 10, 12, 14, 16, 18, 22, 26px. Card padding `14–15px 16–18px`; modal body `22px 24px`; page padding `26px 28px 48px` desktop / `18px 16px 40px` narrow.

**Radius** — 3px badges, 5px chips, 7px inputs and small buttons, 8px buttons and panels, 9px cards, 10px large cards, 12px modals, 16px pills, 50% avatars and dots.

**Shadow** — one only: `0 24px 60px rgba(15,28,34,.28)` on modals. Overlay scrim `rgba(15,28,34,.55)`. No shadows on cards; borders do that work.

## Assets

- `designs/assets/umch-logo.png` — the UMCH / United Healthcare logo, 22–26px tall in headers. Replace with the canonical asset from the codebase's brand folder if one exists.
- No icon set. The design uses text, coloured dots, pills and two typographic marks (`✓`, `×`). If the codebase has an icon library, icons may replace the dots, but do not introduce decorative iconography.
- Fonts load from Google Fonts in the mocks; self-host in production.

## Files

```
design_handoff_outbound_queue/
├── README.md                                  ← this document
└── designs/
    ├── Outbound Queue - Sign in.dc.html       ← auth, forced first password change
    ├── Outbound Queue - Requester.dc.html     ← lead intake, duplicates, urgent, import cohort
    ├── Outbound Queue - Agent Flow v2.dc.html ← call brief and disposition logging
    ├── Outbound Queue - Supervisor.dc.html    ← live floor + monthly CDR report
    ├── Outbound Queue - Users.dc.html         ← accounts, roles, calling numbers, resets
    ├── support.js                             ← the mock runtime; do NOT port this
    └── assets/umch-logo.png
```

Open each file directly in a browser. All data is mock data inside the file.

## Open Decisions — do not guess

Three things are deliberately unresolved. Each changes the data model, so they need an answer from the product owner before or during implementation rather than a developer's assumption:

1. **Price and information requests.** The WhatsApp logs contain enquiries like "what does an endoscopy cost" that were answered in chat with no call and no outcome. Today they would be forced through a call disposition that does not fit. Options: a second work type alongside "call this lead", or a triage step at intake that routes them somewhere other than the queue. **Not designed yet.**

2. **Late amendments.** Leads arrive with no requested date and the date turns up days later. Undecided: whether an amendment can interrupt a lead an agent already has open, or whether it queues behind the current attempt. Also needs the requester-side lead detail view that would let the amendment be made at all. **Not designed yet.**

3. **Agent screen on a phone.** Requester and supervisor screens are responsive down to phone width. The agent flow is desktop-only by intent (the call centre works at desks). If phone use for agents becomes a requirement, that screen needs a pass.

Also worth stating: **the interface is English-only.** Requesters write in Bangla in the current WhatsApp workflow, and that was reviewed and dropped — no translation layer, and no validation blocking Bangla text typed into free-text notes.
