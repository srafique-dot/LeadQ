-- LeadQ (UMCH Outbound Queue) — Postgres schema
-- Run this once against the database behind DATABASE_URL / POSTGRES_URL
-- (Vercel Postgres / Neon SQL editor, or `psql "$DATABASE_URL" -f db/schema.sql`).

create extension if not exists pgcrypto;

create type role as enum ('requester', 'agent', 'admin', 'superadmin');
create type lead_status as enum ('waiting', 'trying', 'booked', 'closed');
create type level1_code as enum ('connected', 'not_responding', 'busy', 'number_off', 'invalid_number', 'call_rejected');
create type level2_code as enum (
  'appointment_purchased', 'appointment_booked', 'info_given', 'callback_later',
  'ni_price', 'ni_distance', 'ni_elsewhere', 'wrong_person', 'duplicate'
);
create type lead_type as enum (
  'appointment', 'vaccine_query', 'lab_test', 'radiology', 'investigative_procedure',
  'surgery_package', 'health_package', 'corporate_health', 'therapy', 'dialysis', 'ipd', 'day_care',
  'international_patient', 'general_inquiry'
);

create table accounts (
  employee_id text primary key check (employee_id ~ '^[A-Za-z]{2,}_\d{2,6}$'),
  name text not null,
  email text not null default '',
  role role not null,
  password_hash text not null,
  must_change_password boolean not null default true,
  calling_number text not null default '',
  active boolean not null default true,
  facility text not null default '',
  -- Declared by the agent (Available / Break / signed off), never inferred
  -- from activity. Routing only hands new work to 'available' agents, and
  -- only reclaims another agent's untouched leads when they are not.
  presence text not null default 'off' check (presence in ('available', 'break', 'off')),
  presence_at timestamptz,
  -- Signed session cookies carry this number; bumping it (password reset,
  -- deactivation, password change) signs the account out everywhere.
  session_version int not null default 0,
  -- Five wrong passwords lock sign-in for 15 minutes.
  failed_logins int not null default 0,
  locked_until timestamptz,
  created_at timestamptz not null default now()
);

-- A superadmin-issued link letting one person self-register their own
-- account. Role/facility/calling number are fixed by whoever creates the
-- invite; the invitee only supplies their name, EID, email and password.
create table invites (
  token text primary key default encode(gen_random_bytes(16), 'hex'),
  role role not null,
  facility text not null default '',
  calling_number text not null default '',
  created_by text not null references accounts(employee_id),
  created_at timestamptz not null default now(),
  used_at timestamptz,
  used_by text references accounts(employee_id)
);

-- Metadata about an upload batch (e.g. "Dr. Shelly's patient base"),
-- separate from the leads themselves — one row per cohort, not one per
-- lead, so instructions can be added/edited without touching every row.
create table cohorts (
  name text primary key,
  instructions text not null default '',
  created_by text not null references accounts(employee_id),
  created_at timestamptz not null default now()
);

-- Superadmin-managed list of "how did this lead come in" values. Free text
-- (not an enum) so a superadmin can add one without a schema change.
-- created_by is null for the three the system ships with: nobody added them,
-- and on a fresh database there is no account to attribute them to yet.
create table channels (
  name text primary key,
  active boolean not null default true,
  created_by text references accounts(employee_id),
  created_at timestamptz not null default now()
);
insert into channels (name, active) values
  ('Manual entry', true),
  ('Website LP', true),
  ('Door2Door Campaign', true);

-- Small generic key/value store for superadmin-editable app config that
-- doesn't warrant its own table. Currently: the three SMS templates an
-- agent copies from at fixed points in the disposition flow (there is no
-- SMS gateway — LeadQ generates the text, the agent sends it from their own
-- phone). Seeded with sensible defaults so the flow works before anyone
-- edits them.
create table settings (
  key text primary key,
  value text not null default '',
  updated_by text references accounts(employee_id),
  updated_at timestamptz not null default now()
);
insert into settings (key, value) values
  ('sms_missed_call', 'Hi {name}, we tried calling you regarding your enquiry with United Healthcare. Please call us back at your convenience. Thank you.'),
  ('sms_callback_confirm', 'Hi {name}, confirming we will call you back on {date} regarding your enquiry with United Healthcare.'),
  ('sms_booking_confirm', 'Hi {name}, your appointment with {doctor} at {facility} is confirmed for {date} {time}. Please arrive 15 minutes early with any previous reports.');

create table leads (
  id text primary key default 'L-' || upper(encode(gen_random_bytes(5), 'hex')),
  name text not null,
  phone text not null,
  -- Strip first, then take the last 10: must match digitsOf() in api/_leads.ts
  -- or "017 1234 5678" and "01712345678" are not seen as the same number.
  digits text generated always as (right(regexp_replace(phone, '\D', '', 'g'), 10)) stored,
  lead_type lead_type not null default 'appointment',
  facility text not null default '',
  area text not null default '',
  doctor text not null default '',
  department text not null default '',
  patient_name text not null default '',
  want_date date,
  preferred_time text not null default '',
  email text not null default '',
  note text not null default '',
  status lead_status not null default 'waiting',
  detail text not null default '',
  urgent boolean not null default false,
  urgent_reason text not null default '',
  merged boolean not null default false,
  cohort text not null default '',
  owner_id text not null references accounts(employee_id),
  owner_name text not null,
  channel text not null default 'Manual entry',
  existing_patient boolean not null default false,
  attempt int not null default 1,
  next_action_date date,
  erp_ref_type text not null default '' check (erp_ref_type in ('', 'booking', 'invoice')),
  erp_ref_value text not null default '',
  escalated boolean not null default false,
  escalated_by text not null default '',
  escalated_at timestamptz,
  escalated_reason text not null default '',
  -- After a failed attempt the lead is held out of the queue until this
  -- time, so the retry ladder is spaced out rather than redialled at once.
  retry_after timestamptz,
  -- Routing. assigned_to is the agent this lead belongs to: set when it is
  -- handed out, and made sticky to whoever last logged an outcome on it so
  -- follow-ups go back to the person who already spoke to them. claimed_by
  -- is the short-lived "I am on this call right now" lock, taken atomically
  -- so two agents can never dial the same number; it expires on its own
  -- (see CLAIM_TTL_MIN) so a lead is never stuck behind someone who walked
  -- away. A claim held by someone other than assigned_to is a one-time
  -- loan — the disposition hands the lead back to its owner, not the
  -- borrower.
  assigned_to text references accounts(employee_id),
  assigned_at timestamptz,
  claimed_by text references accounts(employee_id),
  claimed_at timestamptz,
  created_at timestamptz not null default now()
);
create index leads_digits_idx on leads (digits);
create index leads_status_idx on leads (status) where status in ('waiting', 'trying');
create index leads_owner_idx on leads (owner_id);
create index leads_assigned_idx on leads (assigned_to) where status in ('waiting', 'trying');
create index leads_claimed_idx on leads (claimed_by) where claimed_by is not null;

-- A phone number's earlier enquiries, once merged into one lead card.
create table lead_entries (
  id bigserial primary key,
  lead_id text not null references leads(id) on delete cascade,
  channel text not null,
  happened_at text not null,
  service text not null default '',
  note text not null default '',
  created_at timestamptz not null default now()
);
create index lead_entries_lead_idx on lead_entries (lead_id);

-- One row per logged call outcome. Normalized (not JSONB) because the
-- Supervisor screen aggregates this by agent and by day.
create table dispositions (
  id bigserial primary key,
  lead_id text not null references leads(id) on delete cascade,
  attempt int not null,
  agent_id text not null references accounts(employee_id),
  agent_name text not null,
  l1 level1_code not null,
  l2 level2_code,
  note text not null default '',
  created_at timestamptz not null default now()
);
create index dispositions_lead_idx on dispositions (lead_id);
create index dispositions_agent_day_idx on dispositions (agent_id, created_at);

-- One row per uploaded monthly CDR file (metadata only — rows live in cdr_rows).
create table cdr_uploads (
  month_key text primary key, -- 'YYYY-MM'
  file_name text not null,
  uploaded_by text not null,
  uploaded_at timestamptz not null default now()
);

create table cdr_rows (
  id bigserial primary key,
  month_key text not null references cdr_uploads(month_key) on delete cascade,
  extension text not null,
  number_dialled text not null,
  start_time text not null,
  duration_sec int not null default 0,
  connected boolean not null default false
);
create index cdr_rows_month_idx on cdr_rows (month_key);
create index cdr_rows_ext_idx on cdr_rows (extension);
