# Outbound queue management design brief

_Started 2026-09-05 13:07 UTC_

---

## User

Outbound Queue Management — Design Brief (Phase 1)

System purpose
Centralized routing and disposition layer between digital lead ingestion channels and the call center for UMCH. Replaces WhatsApp-based tracking. Scoped for digital MQLs and SQLs only. Built self-serve via Claude Code on a company VPS with Postgres. The existing call center panel handles inbound and other traffic separately and has no API, only a UI, so it stays out of this build.

This is phase 1. Referral tracking, activation capture, and retention triggers are phase 2 and out of scope here, they belong under a future CRM layer, not this build.

Ingestion channels, phase 1

Website LP (webhook)
Meta Lead Ads (webhook)
Google Lead Form Ads (webhook)
Google Forms (Apps Script onFormSubmit trigger to webhook)
Manual CSV or direct entry for offline and referral leads

WhatsApp/Messengers and a planned App were raised in an earlier scoping pass as future ingestion points, not yet specced, treat as phase 2+ until reconciled.

Roles

Requester, outreach/BD, submits manual leads
Qualifier, reviews and approves/rejects leads before queue entry
Agent, works the queue
Supervisor, reassignment, reporting, override

Open question, unresolved: whether a Qualifier's rejection is final or if Requesters get a dispute path.

Disposition state machine
Two-level code structure replacing free-text status.

Level 1, call outcome (connected, not responding, busy, number off, etc.)
Level 2, sub-disposition, populated only if connected

Retry ladder capped at 4 attempts before a lead closes as exhausted

Call
Call, varied time of day
Call plus SMS
Final call

For missed calls from hot leads specifically, the agreed ladder sequence is New, Called 1x, Called 2x, Called 3x, SMS Sent, Passive Retargeting.

SMS
Sent on-demand through an existing API-connected SMS client, agent-triggered, not tied only to attempt 3. Fields needed, sms_sent, sms_trigger (auto at attempt 3 or manual), sms_delivery_status (from the client's API callback).

Agreed missed-call SMS copy, single variable-free version to minimize operational error at scale
"Dear Sir/Madam, we tried to reach you regarding your enquiry on our website but couldn't connect. Please call us back at 10688 at your convenience."
Tone precedent is formal but warm, "Dear Sir/Madam" as opener for service-disruption-type messages, no personalization variables, must not read as a system notification.

VIP routing
VIP leads skip the queue and route to senior agents only.

Schema, outbound disposition layer
lead_id, facility, facility_id, assigned_agent, disposition_code, sub_disposition_code, attempt_number, max_attempts, sms_sent, sms_trigger, sms_delivery_status, next_action_date, appointment_datetime, closure_reason, notes, is_vip, agent_tier

facility_id is first-class from day one so Medix, MA Rashid, and other facilities can onboard without a schema retrofit.

Prerequisites flagged, not yet built

Attribution infrastructure (UTM parameters, fbclid, gclid) needs setup before this goes live
Lead ingestion wiring for all channels above
VPS and infrastructure provisioning
Billing/EMR completion loop for revenue attribution

This is ready to hand to Claude Design as-is.

## Assistant



## Assistant

_[tool: list_files]_

Design system project is empty, so I'll set the visual direction myself. A few calls before building:

_[tool: ask_user]_

Waiting on your answers — mainly the deliverable format and which screens to prioritize.

## User

Answered — Asked for follow-up questions; deliverable: Interactive prototype of the working screens, Spec doc — schema, state machine, flows, Wireframes across all roles first, hi-fi after; screens: Agent queue / worklist, Agent call disposition panel, Requester manual lead entry, Lead detail / history timeline, CSV bulk import; primary_role: Agent; density: One lead at a time, guided; context: I dont want to take too much time in training them. There are more than one agent, they work in rosters. So each will have their own password (the password with determine their agent name and logins.…;…

## Assistant



## Assistant

_[tool: ask_user]_

Round two is up — calling-window strictness, guided layout, and how calls get dialed.

## User

Answered — Asked for follow-up questions; call_window: Soft warn — banner + confirm dialog, agent can proceed; guided_shape: option_3; phone_reality: Both: click-to-call with manual outcome entry as fallback

## Assistant



## Assistant

_[tool: ask_user]_

Final round posted — queue control, language, and the connected-call sub-dispositions.

## User

Answered — Asked for follow-up questions; queue_order: System decides — agent gets the next lead, no choosing; language: English only; sub_dispositions: Appointment booked, Info given — will decide, Wants callback later, Not interested — price, Not interested — distance/location, Not interested — went elsewhere, Wrong person / wrong number, Duplicate…; open2: 1. What are the best practices in terms of disposition for the best call centers globally

## Assistant



## Assistant

Quick answer on your open question: global call-center practice converges on a few rules — keep level 1 to ~6 mutually exclusive *contact* outcomes (never mix "why" into "did we reach them"), keep level 2 under ~10 and make every code map to a next action, forbid free text as a status, make one code the mandatory terminal state (your "exhausted"), and audit code distribution monthly — if any code exceeds ~40% of volume it's a dumping ground. Your two-level structure is already the right shape.

_[tool: ask_user]_

Two final picks are up — wrap-up rules and appointment capture depth.

## User

Answered — Asked for follow-up questions; wrap_rules: Force a next_action_date on every non-terminal outcome, Mandatory notes only on “not interested” codes, Auto-advance to next lead after save (no dead time), Lock the lead to the agent until dispositi…; appointment: Picker, facility, and service/department

## Assistant



## Assistant

_[tool: ask_user]_

Last round is up — visual direction, any brand assets, and where "Send SMS" lives.

## User

Answered — Asked for follow-up questions; aesthetic: Clinical calm — white, soft grey, one teal accent, generous spacing

## Assistant



## Assistant

_[tool: ask_user]_

Waiting on build order and whether CSV import lands in this pass.

## User

Answered — Asked for follow-up questions; build_order: Agent guided flow first — queue rail, call, disposition, wrap

## Assistant



## Assistant

_[tool: ask_user]_

Waiting on rail contents and the post-login landing.

## User

Answered — Asked for follow-up questions; rail_content: Today's remaining count, Channel badge (Meta / Google / LP / manual), Attempt number per lead, Time since lead arrived (SLA age), VIP flag, Facility name, Next-action-due leads separated from fresh l…; shift_start: Straight into the first lead — zero friction

## Assistant



## Assistant

_[tool: ask_user]_

Waiting on the edge cases to cover and whether supervisor escalation appears in the agent flow.

## User

Answered — Asked for follow-up questions; edge_cases: Lead calls back mid-shift — agent needs to find them fast, Agent must pause queue (break, escalation, bathroom), Roster handover — unfinished callbacks pass to next shift, Network drop mid-dispositio…; supervisor_visibility: Escalate-to-supervisor button

## Assistant



## Assistant

_[tool: ask_user]_

Waiting on duplicate handling and the correction window.

## User

Answered — Asked for follow-up questions; duplicates: Merge on phone number at ingestion — one lead, multiple channel tags; correction: Agent can edit for 15 min

## Assistant



## Assistant

_[tool: ask_user]_

Assumptions listed for your check — say go and I'll build the agent flow.

## User

Answered — Asked for follow-up questions; final_open: 1. There should be a rule that if a callback has been tried atleast thrice without any success, the agent should send an sms (mandatory)

## Assistant



## Assistant

_[tool: ask_user]_

Waiting on how hard to enforce the attempt-3 SMS and what happens when delivery fails.

## User

Answered — Asked for follow-up questions; sms_gate: Block the save — disposition can't be submitted until SMS is sent

## Assistant



## Assistant

_[tool: ask_user]_

One last item — SMS failure behavior — then I start.

## User

Answered — Asked for follow-up questions

## Assistant



## Assistant

_[tool: ask_user]_

Waiting on your speed-to-lead target and the metrics you'll judge this on.

## User

Answered — Asked for follow-up questions; sla: Under 5 minutes — speed-to-lead is the whole game; success_metric: Contact rate, Appointments booked per shift, Attempts per lead, Speed to first call, Leads closed as exhausted

## Assistant



## Assistant

_[tool: ask_user]_

Waiting on fresh-lead interrupt behavior and SLA breach handling.

## User

Answered — Asked for follow-up questions; sla_interrupt: Notify now, serve it the moment the current lead is dispositioned; sla_breach: Both

## Assistant



## Assistant

_[tool: ask_user]_

Waiting on the pre-call context fields and note-entry style.

## User

Answered — Asked for follow-up questions; lead_context: What they enquired about (service/department), Ad or campaign name, Landing page / form they came from, Full attempt history with timestamps and codes, Previous agent's notes, Whether they're an exis…; notes_style: Quick-tap common notes + free text

## Assistant



## Assistant

_[tool: ask_user]_

Final check is up — say "Build it" and I'll start on the agent flow.

## User

Answered — Asked for follow-up questions; anything: 1. You don't have to worry about sms failure. I have an inbound panel, now im making an outbound panel, and I have an sms panel. All of them are separate solutions

## Assistant



## Assistant

_[tool: ask_user]_

Waiting on the SMS handoff model and how inbound callbacks reach the outbound record.

## User

Answered — Asked for follow-up questions; inbound_link: Manual note that they called back inbound

## Assistant



## Assistant

_[tool: ask_user]_

Waiting on the SMS storage choice and your go-ahead.

## User

Answered — Asked for follow-up questions; sms_store: Sent + timestamp only; final_go: Build it

## User

You have all the answers?

## Assistant

_[tool: list_files]_

_[tool: read_file]_

Design system project is empty, so I'm setting the direction myself — clinical calm, teal accent, per your pick. Building the agent flow now.

_[tool: dc_write]_

## Assistant

## Assistant

_[tool: dc_write]_

## Assistant

_[tool: dc_write]_

## User

what's up?

## Assistant

_[tool: list_files]_

Status: the design system project is empty, so nothing to pull from — I'm building on the clinical-calm teal direction you picked. My last write got interrupted, so the file is still a stub. Rebuilding it now in one pass.

_[tool: dc_write]_

_[tool: ready_for_verification]_

Agent flow is up — three guided steps (brief → call → disposition) with the queue rail read-only on the left.

What's enforced in the UI, per your answers: 4-attempt ladder shown as "2 of 4"; mandatory SMS at attempt 3 that blocks the save; next_action_date forced on every non-terminal outcome; notes mandatory on not-interested codes; auto-advance on save; 15-minute correction window; soft-warn banner outside 10am–11pm; fresh-lead notification that serves after the current disposition; pause, escalate, phone search, and inbound-callback note. Draft state persists so a network drop doesn't lose work.

Two things I decided for you: SMS stores sent + timestamp only (delivery stays in your SMS panel), and Send SMS appears in the disposition step. Requester entry, lead detail, and CSV import are next when you want them.

## User

Found issues — fixing…

## Assistant

_[tool: str_replace_edit]_

_[tool: ready_for_verification]_

Fixed: the work area and lead-record panel now wrap instead of squeezing, so the guided column stays wide at 1366px+ and stacks cleanly in a narrow preview. Campaign and source strings wrap rather than clip, and the ladder's trailing connector rule is gone.

## User

here's the agent journey flow
agent logs on this platform for outbound list → get leads assigned for calls → makes the call through our call center panel (external), → books on our erp (another external) → enters the disposition of the call along with booking details (if booked) and payment details (if paid) on this lead managment platform

discuss dont code

## Assistant

Understood. That journey changes three things I built on the wrong assumption.

**1. Click-to-call should go.** You told me earlier "both — click-to-call with manual outcome entry as fallback." But if the call is placed in the external call center panel, this app can't dial or time the call. My step 2 ("On call" with a live timer) is fiction. The honest shape is two steps, not three: *Brief → Log outcome*. The dial button becomes "Reveal / copy number" at most. Worth confirming, because it also means no talk-time metric here — that lives in the call center panel.

**2. The app is now a post-hoc logging layer, and that's a data-integrity problem.** The agent does the real work in two other systems, then re-types the result here. Every re-typed field is a chance for drift: an appointment that exists in the ERP but not here, or vice versa. Two questions follow:
- Is the ERP booking ID the key the agent enters, so this record points at the ERP rather than duplicating it? That's much safer than re-capturing date/time/facility/department by hand — and it makes the appointment fields I built mostly redundant.
- What happens when they book in the ERP and then never come back to log it? That's the most likely failure mode in a 13-hour shift, and it silently destroys your booked-per-shift metric. Something has to reconcile — a "you have 3 unlogged bookings" nudge, or a supervisor exception list.

**3. Payment is new scope and it's the important part.** It wasn't in the brief's schema — nothing about amount, method, transaction reference, or partial payment. Payment is also what turns "booked" into revenue, which is exactly your phase-2 attribution goal. Before I design it I need to know: is payment always at booking, or later at the facility? Full or deposit? Does the agent take a payment reference from the ERP, or just mark paid/unpaid? And critically — if the agent enters an amount here that disagrees with the ERP, which one is true? If this app is not the system of record for money, it should capture a reference and a status, never an amount.

**One structural observation.** Your two-level disposition assumed the outcome *is* the disposition. With booking and payment as separate external steps, you now have three independent axes: did we connect, did they book, did they pay. A lead can be connected + booked + unpaid, or connected + not booked. Squeezing that into `sub_disposition_code` will get messy fast — "appointment booked" as a level-2 code can't also tell you payment state. I'd suggest keeping level 1 and 2 as pure *call* outcomes and adding `booking_status` + `booking_ref` + `payment_status` + `payment_ref` as separate fields. That's a small schema addition now versus a painful retrofit later, and it keeps each code meaning exactly one thing — which is the discipline that made your two-level structure right in the first place.

Tell me your answers on payment timing and the ERP booking ID, and I'll rework the flow to two steps with the booking/payment block.

## User

listen, everything gets captured on the ERP regarding the bookings and the payment. all this lead managment platform will do is traffic the incoming leads to the outbound agents. the agents will in return call them and submit the disposition or the outcome of the call 

does that make sense?

## Assistant

Yes, completely — and it makes the build simpler, not more complex. This platform is a router plus a disposition log. Nothing else.

That means I over-built one thing. The appointment block I put in — date, time, facility, department pickers — is duplicate data entry. The ERP already owns it. "Appointment booked" should be a level-2 disposition code and nothing more: a fact about how the call ended, not a record of the booking. I'd cut those four fields entirely. Same for `appointment_datetime` in the schema — it's a shadow copy of an ERP field, and shadow copies drift.

Worth noting what you lose and whether you care: with no booking reference stored here, this platform can't tell you which leads converted. It can tell you an agent *coded* a call as booked, which is an agent-reported number, not an ERP-confirmed one. For phase 1 that's probably fine — you're replacing WhatsApp tracking, and agent-reported is infinitely better than nothing. But if you ever want true revenue attribution per channel, the join happens later between this platform's `lead_id` and the ERP, and that join needs *some* shared key. A single optional `erp_ref` field the agent can paste when they have it costs almost nothing now and is the one thing that makes phase-2 attribution possible. Your call — I'd include it as optional, never required, never blocking the save.

Two other consequences:

The three-step flow collapses to two. Brief → log outcome. No call timer, no dial button, since the call happens in the call center panel. The primary action on the brief screen becomes the phone number itself, large and copyable, because that's the one thing the agent needs to carry across to the other system.

And the SMS stays as-is — that's genuinely this platform's job, since it triggers your SMS panel and the mandatory-at-attempt-3 rule needs somewhere to live.

Want me to make those changes: cut appointment capture, collapse to two steps, keep an optional ERP reference field?

## User

It could help the tracking and reconciliation... but that's for a future phase, right? So we could track the booking or invoice ID for these conversions on this platform

## Assistant

Right — but there's an asymmetry worth naming. The *reconciliation* is phase 2. The *field* has to exist in phase 1, because you can only reconcile leads that were dispositioned after the field existed. Add it in month six and every conversion from months one through five is unreconcilable forever. That data doesn't come back.

So: build the field now, use it later. It's one nullable column and one input box — genuinely the cheapest insurance in this whole build. And it stays optional and non-blocking, so it never becomes a reason an agent can't save a disposition.

Two decisions on how it behaves:

**Which ID?** Booking ID and invoice ID aren't the same event. A booking exists the moment the ERP slot is created; an invoice exists once money is involved. If you capture only one, booking ID is the better choice — it exists for every conversion, whereas unpaid bookings have no invoice. If you want both, that's two fields, and the invoice one will be blank most of the time an agent is logging the call (payment often happens later, at the facility). I'd start with booking reference only.

**Shown when?** Only when the agent picks "Appointment booked." It has no meaning on any other code, and showing it always invites garbage entry. One field, one label like "ERP booking reference — optional", appearing under that single disposition.

That gives you `erp_booking_ref` on the schema alongside the disposition fields, populated on maybe 15–20% of records, and it's the hook your future CRM layer joins on.

So the change set is: cut the appointment date/time/facility/department capture, collapse to two steps, add the optional booking reference under "Appointment booked." Say go and I'll build it.

## User

booking ID if not paid. Invoice number if paid

## Assistant

That's cleanly modelled as one reference plus a type, not two fields. The agent answers "paid?" first, and that decides what you're asking them for:

- Not paid → "ERP booking ID"
- Paid → "Invoice number"

Stored as `erp_ref_type` (booking | invoice) and `erp_ref_value`. Two columns, one visible input, and the type is never ambiguous because the agent's own answer set it. If instead you stored a single untyped `erp_ref`, you'd be guessing later whether a given string is a booking or an invoice — and your reconciliation job would have to guess too.

One thing this quietly gives you that's worth more than the reference itself: a paid/unpaid flag on the conversion. Not an amount, not a payment record — just whether money moved at the time of the call. That's the difference between "agent says they booked" and "they committed," and it's the single most useful number you'll have in phase 1 for judging channel quality. Meta leads that book and pay are worth something very different from Meta leads that book and vanish.

Both fields stay optional and non-blocking — if the agent doesn't have the ID to hand, they save anyway. An unlogged reference is a phase-2 gap; a blocked disposition is a phase-1 failure.

Ready to build: cut appointment capture, collapse to two steps (brief → log outcome), and add the paid toggle plus the typed reference under "Appointment booked."

## User

up

## Assistant

_[tool: read_file]_

Making the changes now — cutting the call step and appointment capture, adding the paid toggle and typed ERP reference.

_[tool: dc_html_str_replace]_

_[tool: dc_html_str_replace]_

_[tool: dc_html_str_replace]_

_[tool: dc_html_str_replace]_

Now replacing the appointment block with the paid toggle + typed reference.

_[tool: dc_html_str_replace]_

Now the logic: drop call/appointment state, add paid + typed reference.

_[tool: dc_js_str_replace]_

_[tool: dc_js_str_replace]_

That logo is UnitedHealthcare's — the US health insurer's registered trademark. I can't put it on a UMCH product; that's someone else's mark on your system. If UMCH is actually part of that group and you have rights to it, tell me and I'll use it.

Otherwise: your teal (#0E7C86) is already very close to that mark's color, so a simple "UMCH" wordmark in the rail will sit naturally with what's built. Send me your real logo file and I'll drop it in.

Meanwhile, finishing the ERP reference changes:

_[tool: dc_js_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: dc_js_str_replace]_

Already enforced — but let me finish the pending edits first, since the file is mid-change.

_[tool: dc_js_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: dc_html_str_replace]_

That artwork is UnitedHealthcare Inc.'s registered mark — the US insurer. Everything else in this build points to UMCH in Dhaka: Medix, MA Rashid, the 10688 hotline. Those are different entities, and I can't place that mark on this system on the strength of the file alone.

If UMCH does hold rights to it, the quickest unblock is your own brand file from a UMCH source — a brand kit, a page on your domain, anything issued by the hospital. Send that and I'll use it immediately, no further questions.

For now the rail carries a plain "UMCH Outbound" wordmark in your teal, which is safe to ship and trivial to swap later.

Finishing the enforcement rule you just raised:

_[tool: dc_js_str_replace]_

Lightening the rail to match the clinical-calm direction.

_[tool: run_script]_

_[tool: grep]_

That one's correct — it's the selected-outcome card on teal, not the rail.

_[tool: ready_for_verification]_

Rail is now light — white surface, teal for the selected lead, amber only on the paused state. SLA and "booked" colors darkened so they still read at small sizes on white.

Also landed in this pass, from our discussion:

- Two steps instead of three. No dialer, no call timer — the brief screen now shows the number large with a copy button, since the call is placed in your call center panel.
- Appointment capture cut. The ERP owns it.
- Under "Appointment booked": a Paid / Not paid toggle, and one reference field that becomes *ERP booking ID* or *ERP invoice number* depending on the answer. Optional, never blocks the save. Stored as `erp_ref_type` + `erp_ref_value` + `payment_taken`.
- Unreachable outcomes now state the rule explicitly on screen: no closure before 3 calls, SMS mandatory at attempt 3, exhausted only at 4.

On the logo — I still can't use that file. Send a UMCH-issued brand asset and it goes in straight away.

## User

this IS our logo. that one you are talking about is a half U with ingido stripes

## Assistant

Understood — going on your confirmation that this is UMCH's own mark. The rail is white now, so the dark wordmark sits on it cleanly.

_[tool: copy_files]_

_[tool: dc_html_str_replace]_

_[tool: ready_for_verification]_

_[tool: run_script]_

_[tool: ready_for_verification]_

Type sizes raised across the board — the smallest labels went from 9.5px to 11.5px, body copy from 12–13px to 13.5–14px, and the uppercase micro-labels from 10px to 12px. Rail widened to 322px so the bigger type doesn't crowd.

## User

i think once, the agent inputs not responding or buys or number of... whatever, you take it off put it at teh back of the queue not more than 15 mins later

## Assistant

_[tool: dc_html_str_replace]_

_[tool: run_script]_

_[tool: ready_for_verification]_

Done. Unreachable outcomes now requeue automatically — no date field to fill, just a confirmation showing the clock time it comes back (12 min out, inside your 15-minute cap). The date picker only appears for connected outcomes like "wants callback later," where a real future date makes sense. At attempt 4 there's no requeue; it closes as exhausted.

One tension worth deciding later: your ladder step 2 is "call at a varied time of day," which assumes hours between attempts. A 15-minute requeue means all four attempts can land inside an hour — so a genuinely busy person gets exhausted before they've had a chance to pick up. You may want the 15-minute rule for attempt 1→2 only, then wider gaps after. Say the word and I'll change the spacing.

_[tool: run_script]_

_[tool: run_script]_

_[tool: ready_for_verification]_

Both fixed, plus your legibility request landed:

- Names are now 30px in the header and 15.5px in the rail; phone numbers are large mono — 32px on the brief card, 19px in the header.
- Every number is a copy button: click it in the rail, the header, or the brief card and it goes to the clipboard for pasting into your dialer, with a "Copied" confirmation.
- Ladder rebuilt as a four-segment bar with labels beneath, so it can't strand a step at any width.
- SLA amber and red darkened to hold contrast on the white rail.

## User

Found issues — fixing…

## Assistant

_[tool: run_script]_

_[tool: ready_for_verification]_

Key column widened to 156px, so `sub_disposition_code` and any future 20-character key fit without colliding with the value.

## User

Found issues — fixing…

## Assistant

Root cause: my rail-lightening pass reused muted tones designed for the dark surface (#7B939B/#8AA0A7 → #8B9CA3), so every secondary label is now light ink on a light ground. One palette-level fix rather than per-element tweaks:

_[tool: run_script]_

_[tool: ready_for_verification]_

Muted palette darkened at the source — 33 label instances moved from #8B9CA3 to #55686F, plus the ladder numerals, outcome-card hints, banner caption and VIP badge ink. That was the real gap between "bigger type" and actually legible: the sizes went up but the ink stayed at dark-rail strength.

## User

Found issues — fixing…

## User

Found issues — fixing…

## User

what does this button do?

## Assistant

It's the step 1 → step 2 advance. The agent reads the brief, copies the number, dials in your call center panel — then clicks this to open the disposition form and log what happened.

It's not placing a call; nothing about it touches the phone. The label is meant to read as "I've already called, now let me log it." If that's ambiguous on the floor, "Log the outcome" or "Enter disposition" is clearer — say which you prefer and I'll change it.

## User

these are low quality agents, non native english speakers. they dont need to figure this UX they themselves

## Assistant

Fair — then the screen should tell them exactly what to do, in order, with no inference. Rebuilding that footer as three numbered steps:

_[tool: run_script]_

_[tool: ready_for_verification]_

The brief screen is now four numbered steps in plain, short English — copy the number, paste and call, enter bookings in the ERP, then press "The call is finished." No inference required; the number badges carry the order even if the words are skimmed.

Two things worth considering for this audience, if you want them:

The disposition codes are still English phrases like "Not interested — went elsewhere." Bangla labels alongside the English would remove the main remaining reading burden — you chose English-only earlier, but that was before you told me about the agents' English level. Worth revisiting.

And the eight level-2 codes are presented as a flat grid. For low-experience agents, grouping them under three plain headings — *Booked* / *Still deciding* / *Not interested* — makes the choice much faster and reduces miscoding, which is what corrupts your reporting.

## User

what to do here?

## Assistant

It's "when should we call this person again?" — but the label doesn't say that, and the red box gives no instruction. Rewriting it as a question with the quick buttons as the main answer:

_[tool: run_script]_

_[tool: grep]_

_[tool: read_file]_

_[tool: run_script]_

_[tool: ready_for_verification]_

That block now asks a plain question — "When should we call this person again?" — with four large buttons as the answer: Later today, Tomorrow, In 2 days, Next week. The picked one turns teal so it's obvious something was chosen, and the chosen date is echoed back in words ("Chosen · Mon 8 Sep") since mm/dd/yyyy is easy to misread. The date field is now secondary, labelled "Or choose another day," and no longer starts outlined in red.

## User

escalate to supervisor

## Assistant

Making the label say what it does:

_[tool: run_script]_

_[tool: ready_for_verification]_

Now reads "Send to supervisor" — plainer than "Escalate," which is a word these agents may not know. It hands the lead to the on-duty supervisor with the notes attached, removes it from the agent's queue, and moves them to the next lead. The confirmation dialog already spells that out in the same plain terms.

## User

this should pop up, when wants a callback later is selected

## Assistant

_[tool: run_script]_

_[tool: ready_for_verification]_

Done — it now appears only on "Wants callback later," and is required there.

One consequence to flag: "Info given — will decide" no longer asks for a date either. That lead is still open but has nothing scheduled, so it will sit in the queue with no follow-up trigger. Either it should also ask for a date, or it needs to be treated as terminal and closed. Tell me which and I'll set it.

## User

ERP tracking number should be there... appointment booking ID or invoice number

## Assistant

It's already built — pick **Connected → Appointment booked** and it appears: a Paid / Not paid toggle, then one field that becomes *ERP booking ID* when not paid and *ERP invoice number* when paid.

Making the question plainer for the agents while I'm there:

_[tool: run_script]_

_[tool: grep]_

_[tool: run_script]_

_[tool: ready_for_verification]_

Now reads "ERP tracking number", with "Did they pay?" → *Not yet* / *Yes, paid*, and the field label spelling it out in full: "Appointment booking ID from the ERP" or "Invoice number from the ERP". Buttons enlarged to match the rest of the disposition form.

## User

Found issues — fixing…

## Assistant

Root cause: `next_action_date` is derived from state with only the requeue guard, so a terminal disposition keeps a stale callback date. Same fix pattern as `booked`:

_[tool: run_script]_

_[tool: ready_for_verification]_

Fixed the same way as the payment fields — three named guards (`booked`, `requeued`, `scheduled`) now drive both the visible fields and the record, so `next_action_date` only exists for a callback or an auto-requeue and reads "—" on any closed disposition, whichever way the agent switches codes.

