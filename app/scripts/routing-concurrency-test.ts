/**
 * Concurrency test for lead routing against a real Postgres.
 *
 * Imports the shipped api/_routing.ts unmodified, so what's verified here is
 * the actual production SQL, not a restatement of it. Point DATABASE_URL at a
 * throwaway database loaded with db/schema.sql and run with tsx.
 */
import { query, pool } from "../api/_db.js";
import { claimLead, topUpWorkingSet, releaseStaleAssignments, borrowableSql, WORKING_SET } from "../api/_routing.js";

let failures = 0;

function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

async function resetLeads() {
  await query("update leads set assigned_to = null, assigned_at = null, claimed_by = null, claimed_at = null, status = 'waiting'");
  await query("delete from dispositions");
}

/** Two agents grabbing the same lead at the same instant. Exactly one must win. */
async function testSimultaneousClaim() {
  console.log("\nTwo agents claim the same lead simultaneously");
  await resetLeads();

  const results = await Promise.all([
    claimLead("L-000001", "ALPHA_001"),
    claimLead("L-000001", "BRAVO_002"),
  ]);
  const winners = results.filter((r) => r !== null);
  check("exactly one agent wins", winners.length === 1, `${winners.length} won`);

  const { rows } = await query<{ claimed_by: string }>("select claimed_by from leads where id = 'L-000001'");
  check("database holds a single claimant", !!rows[0]?.claimed_by, rows[0]?.claimed_by ?? "none");
  check("the winner is the one recorded", winners[0]?.claimed_by === rows[0]?.claimed_by);
}

/** Heavier version: 20 agents storming one lead. */
async function testClaimStorm() {
  console.log("\n20 concurrent claims on one lead");
  await resetLeads();

  const agents = ["ALPHA_001", "BRAVO_002", "CHARLI_003"];
  const attempts = Array.from({ length: 20 }, (_, i) => claimLead("L-000002", agents[i % agents.length]));
  const results = await Promise.all(attempts);
  const winners = results.filter((r) => r !== null);

  // Repeat claims by the same agent are allowed (idempotent re-open), so the
  // meaningful assertion is that only ONE distinct agent ever holds it.
  const distinctWinners = new Set(winners.map((w) => w!.claimed_by));
  check("only one distinct agent holds the lead", distinctWinners.size === 1, [...distinctWinners].join(", "));
}

/** An expired claim must be takeable by someone else. */
async function testClaimExpiry() {
  console.log("\nExpired claim is reclaimable");
  await resetLeads();

  await claimLead("L-000003", "ALPHA_001");
  const blocked = await claimLead("L-000003", "BRAVO_002");
  check("a live claim blocks another agent", blocked === null);

  await query("update leads set claimed_at = now() - interval '30 minutes' where id = 'L-000003'");
  const afterExpiry = await claimLead("L-000003", "BRAVO_002");
  check("a stale claim can be taken over", afterExpiry !== null);
  check("takeover records the new agent", afterExpiry?.claimed_by === "BRAVO_002", afterExpiry?.claimed_by ?? "none");
}

/** Concurrent top-ups must never hand the same lead to two agents. */
async function testConcurrentTopUp() {
  console.log("\nThree agents top up their working sets at once");
  await resetLeads();

  await Promise.all([
    topUpWorkingSet("ALPHA_001"),
    topUpWorkingSet("BRAVO_002"),
    topUpWorkingSet("CHARLI_003"),
  ]);

  const { rows } = await query<{ assigned_to: string; count: string }>(
    "select assigned_to, count(*)::text as count from leads where assigned_to is not null group by assigned_to order by assigned_to",
  );
  const total = rows.reduce((n, r) => n + Number(r.count), 0);
  console.log(`    distribution: ${rows.map((r) => `${r.assigned_to}=${r.count}`).join(", ")}`);

  const { rows: dupes } = await query<{ count: string }>(
    "select count(*)::text as count from (select id from leads where assigned_to is not null group by id having count(*) > 1) x",
  );
  check("no duplicate assignment rows", Number(dupes[0].count) === 0);
  check("each agent got at most a full working set", rows.every((r) => Number(r.count) <= WORKING_SET), `max ${Math.max(...rows.map((r) => Number(r.count)))}`);
  check("work was actually distributed", rows.length === 3, `${rows.length} agents got leads`);
  check("total assigned matches 3 working sets", total === WORKING_SET * 3, String(total));
}

/** An agent going unavailable releases untouched leads, but keeps ones they
 * have actually called (sticky). */
async function testStaleRelease() {
  console.log("\nStale assignment release respects stickiness");
  await resetLeads();

  await topUpWorkingSet("DELTA_004"); // DELTA_004 is presence 'off'
  const { rows: before } = await query<{ count: string }>(
    "select count(*)::text as count from leads where assigned_to = 'DELTA_004'",
  );
  check("leads were assigned to the off-duty agent", Number(before[0].count) > 0, before[0].count);

  // Mark one as actually worked by them — that one is sticky and must survive.
  const { rows: worked } = await query<{ id: string }>("select id from leads where assigned_to = 'DELTA_004' limit 1");
  const stickyId = worked[0].id;
  await query(
    "insert into dispositions (lead_id, attempt, agent_id, agent_name, l1, l2, note) values ($1, 1, 'DELTA_004', 'Delta Agent', 'connected', 'callback_later', '')",
    [stickyId],
  );

  await releaseStaleAssignments();

  const { rows: after } = await query<{ id: string }>("select id from leads where assigned_to = 'DELTA_004'");
  check("untouched leads went back to the pool", after.length === 1, `${after.length} still held`);
  check("the lead they actually called stayed with them", after[0]?.id === stickyId, after[0]?.id ?? "none");
}

/** Sticky window expiry: a lead last called more than STICKY_DAYS ago frees up. */
async function testStickyExpiry() {
  console.log("\nSticky window expires after the configured days");
  await resetLeads();

  await query("update leads set assigned_to = 'ALPHA_001', assigned_at = now() where id = 'L-000010'");
  await query(
    "insert into dispositions (lead_id, attempt, agent_id, agent_name, l1, l2, note, created_at) values ('L-000010', 1, 'ALPHA_001', 'Alpha Agent', 'connected', 'callback_later', '', now() - interval '30 days')",
  );

  await releaseStaleAssignments();
  const { rows } = await query<{ assigned_to: string | null }>("select assigned_to from leads where id = 'L-000010'");
  check("a long-cold sticky lead returns to the pool", rows[0].assigned_to === null, rows[0].assigned_to ?? "released");
}

/** A claim held by a non-owner is a loan — a fresh claim by the owner is fine,
 * and the claim itself never silently changes assignment. */
async function testLoanDoesNotTransfer() {
  console.log("\nClaiming someone else's lead does not reassign it");
  await resetLeads();

  await query("update leads set assigned_to = 'ALPHA_001', assigned_at = now() where id = 'L-000020'");
  const borrowed = await claimLead("L-000020", "BRAVO_002");
  check("a colleague can take the call", borrowed !== null);
  check("ownership is unchanged by the claim", borrowed?.assigned_to === "ALPHA_001", borrowed?.assigned_to ?? "none");
  check("the claim records the borrower", borrowed?.claimed_by === "BRAVO_002", borrowed?.claimed_by ?? "none");
}

/** What an agent is offered to cover: overdue work belonging to someone who
 * is away — and nothing belonging to someone who is at their desk. */
async function testBorrowable() {
  console.log("\nCovering work is offered only for absent colleagues");
  await resetLeads();

  // Held by an away agent, never called → coverable.
  await query("update leads set assigned_to = 'DELTA_004', assigned_at = now() where id = 'L-000030'");
  // Held by an available agent, never called → must NOT be offered.
  await query("update leads set assigned_to = 'ALPHA_001', assigned_at = now() where id = 'L-000031'");
  // Held by the asking agent themselves → belongs in their own queue, not here.
  await query("update leads set assigned_to = 'BRAVO_002', assigned_at = now() where id = 'L-000032'");

  const { rows } = await query<{ id: string }>(borrowableSql(), ["BRAVO_002"]);
  const ids = rows.map((r) => r.id);
  check("an absent agent's untouched lead is coverable", ids.includes("L-000030"));
  check("a present agent's lead is left alone", !ids.includes("L-000031"));
  check("an agent is not offered their own work twice", !ids.includes("L-000032"));

  // Once claimed by someone, it stops being offered to anyone else.
  await claimLead("L-000030", "BRAVO_002");
  const { rows: after } = await query<{ id: string }>(borrowableSql(), ["CHARLI_003"]);
  check("a lead under an active claim is no longer offered", !after.some((r) => r.id === "L-000030"));
}

async function main() {
  await testSimultaneousClaim();
  await testBorrowable();
  await testClaimStorm();
  await testClaimExpiry();
  await testConcurrentTopUp();
  await testStaleRelease();
  await testStickyExpiry();
  await testLoanDoesNotTransfer();

  console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) FAILED.`}`);
  await pool.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
