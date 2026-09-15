import { planStatewideConferenceMembershipPopulation } from "./statewide-conference-membership-population.js";

export const M9_PRODUCTION_ONCE_PATH = "/api/v1/internal/m9-production-apply-20260915-7d2b9f4c1a6e";
export const M9_LOCKED_FINGERPRINT = "m9-statewide-membership-1220-228-61764aa2";
export const M9_PRODUCTION_EXPIRES_AT = Date.parse("2026-09-16T03:00:00Z");

const LOCKED = Object.freeze({
  active_eligible_teams: 1220,
  member: 1190,
  independent: 1,
  unknown: 29,
  invalid: 0,
  conference_upserts: 228,
  membership_upserts: 1220,
  team_pointer_changes: 1030,
  data_write_upper_bound: 2478,
  set_based_statements: 3,
  migration: "0016_conference_membership_truth.sql"
});

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-localbleachers-m9-production": "fingerprint-locked-once"
    }
  });
}

function num(value) { return Number(value || 0); }
function metaOf(result) { return result?.meta || {}; }
function telemetry(results = []) {
  return results.reduce((out, result) => {
    const meta = metaOf(result);
    out.rows_read += num(meta.rows_read);
    out.rows_written += num(meta.rows_written);
    out.changes += num(meta.changes ?? result?.changes);
    return out;
  }, { rows_read: 0, rows_written: 0, changes: 0 });
}

function assertLockedPlan(plan) {
  const c = plan?.coverage || {};
  const p = plan?.planned || {};
  const failures = [];
  const expect = (label, actual, expected) => {
    if (actual !== expected) failures.push({ label, actual, expected });
  };
  expect("status", plan?.status, "DRY_RUN");
  expect("safe", plan?.safe, true);
  expect("fingerprint", plan?.fingerprint, M9_LOCKED_FINGERPRINT);
  expect("active_eligible_teams", num(plan?.active_eligible_teams), LOCKED.active_eligible_teams);
  expect("member", num(c.member), LOCKED.member);
  expect("independent", num(c.independent), LOCKED.independent);
  expect("unknown", num(c.unknown), LOCKED.unknown);
  expect("invalid", num(c.invalid), LOCKED.invalid);
  expect("conference_upserts", num(p.conference_upserts), LOCKED.conference_upserts);
  expect("membership_upserts", num(p.membership_upserts), LOCKED.membership_upserts);
  expect("team_pointer_changes", num(p.team_pointer_changes), LOCKED.team_pointer_changes);
  expect("data_write_upper_bound", num(p.data_write_upper_bound), LOCKED.data_write_upper_bound);
  expect("set_based_statements", num(p.set_based_statements), LOCKED.set_based_statements);
  expect("migration", p.migration, LOCKED.migration);
  expect("dry_run_rows_written", num(plan?.d1?.rows_written), 0);
  if (failures.length) {
    const error = new Error("M9 locked production plan no longer matches approved dry-run");
    error.details = failures;
    throw error;
  }
}

async function migrationState(env) {
  const table = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='conference_memberships'").first();
  if (!table) return { exists: false, rows: 0 };
  const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM conference_memberships").first();
  return { exists: true, rows: num(count?.n) };
}

async function applyMigration0016(env) {
  const results = await env.DB.batch([
    env.DB.prepare("PRAGMA foreign_keys = ON"),
    env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS conference_memberships (
        team_id TEXT PRIMARY KEY REFERENCES teams(id) ON DELETE CASCADE,
        conference_id TEXT REFERENCES conferences(id),
        membership_state TEXT NOT NULL CHECK(membership_state IN ('member','independent','unknown')),
        classification TEXT,
        division TEXT,
        authority_provider TEXT NOT NULL,
        authority_key TEXT,
        source_url TEXT,
        verified_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK(
          (membership_state='member' AND conference_id IS NOT NULL)
          OR (membership_state IN ('independent','unknown') AND conference_id IS NULL)
        )
      )
    `),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_conference_memberships_conference_state ON conference_memberships(conference_id,membership_state)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_conference_memberships_authority ON conference_memberships(authority_provider,authority_key)")
  ]);
  return telemetry(results);
}

function conferenceUpsert(env, rows, now) {
  return env.DB.prepare(`
    WITH payload AS (
      SELECT
        json_extract(value,'$.id') AS id,
        json_extract(value,'$.name') AS name,
        json_extract(value,'$.classification') AS classification,
        json_extract(value,'$.standings_method') AS standings_method,
        CAST(json_extract(value,'$.coverage_complete') AS INTEGER) AS coverage_complete,
        json_extract(value,'$.source_url') AS source_url
      FROM json_each(?)
    )
    INSERT INTO conferences(id,name,classification,standings_method,coverage_complete,source_url,updated_at)
    SELECT id,name,classification,standings_method,coverage_complete,source_url,? FROM payload WHERE true
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name,
      classification=excluded.classification,
      standings_method=excluded.standings_method,
      coverage_complete=excluded.coverage_complete,
      source_url=excluded.source_url,
      updated_at=excluded.updated_at
  `).bind(JSON.stringify(rows), now);
}

function membershipUpsert(env, rows, now) {
  return env.DB.prepare(`
    WITH payload AS (
      SELECT
        json_extract(value,'$.team_id') AS team_id,
        json_extract(value,'$.conference_id') AS conference_id,
        json_extract(value,'$.membership_state') AS membership_state,
        json_extract(value,'$.classification') AS classification,
        json_extract(value,'$.division') AS division,
        json_extract(value,'$.authority_provider') AS authority_provider,
        json_extract(value,'$.authority_key') AS authority_key,
        json_extract(value,'$.source_url') AS source_url,
        json_extract(value,'$.verified_at') AS verified_at
      FROM json_each(?)
    )
    INSERT INTO conference_memberships(
      team_id,conference_id,membership_state,classification,division,
      authority_provider,authority_key,source_url,verified_at,updated_at
    )
    SELECT team_id,conference_id,membership_state,classification,division,
      authority_provider,authority_key,source_url,verified_at,? FROM payload WHERE true
    ON CONFLICT(team_id) DO UPDATE SET
      conference_id=excluded.conference_id,
      membership_state=excluded.membership_state,
      classification=excluded.classification,
      division=excluded.division,
      authority_provider=excluded.authority_provider,
      authority_key=excluded.authority_key,
      source_url=excluded.source_url,
      verified_at=excluded.verified_at,
      updated_at=excluded.updated_at
  `).bind(JSON.stringify(rows), now);
}

function teamPointerUpdate(env, rows, now) {
  return env.DB.prepare(`
    WITH payload AS (
      SELECT
        json_extract(value,'$.team_id') AS team_id,
        CASE WHEN json_extract(value,'$.membership_state')='member'
          THEN json_extract(value,'$.conference_id') ELSE NULL END AS conference_id
      FROM json_each(?)
    )
    UPDATE teams
    SET conference_id=(SELECT p.conference_id FROM payload p WHERE p.team_id=teams.id),
        updated_at=?
    WHERE id IN (SELECT team_id FROM payload)
      AND COALESCE(conference_id,'')<>COALESCE((SELECT p.conference_id FROM payload p WHERE p.team_id=teams.id),'')
  `).bind(JSON.stringify(rows), now);
}

async function verifyProduction(env, plan) {
  const expectedIds = plan.memberships.map(row => row.team_id);
  const result = await env.DB.prepare(`
    WITH expected AS (
      SELECT CAST(value AS TEXT) AS team_id FROM json_each(?)
    ), joined AS (
      SELECT e.team_id,
        t.id AS actual_team_id,t.active,t.season,t.conference_id AS team_conference_id,
        cm.team_id AS membership_team_id,cm.membership_state,cm.conference_id AS membership_conference_id,
        c.id AS referenced_conference_id
      FROM expected e
      LEFT JOIN teams t ON t.id=e.team_id
      LEFT JOIN conference_memberships cm ON cm.team_id=e.team_id
      LEFT JOIN conferences c ON c.id=cm.conference_id
    )
    SELECT
      COUNT(*) AS expected_teams,
      SUM(CASE WHEN membership_team_id IS NOT NULL THEN 1 ELSE 0 END) AS membership_rows,
      SUM(CASE WHEN membership_state='member' THEN 1 ELSE 0 END) AS member,
      SUM(CASE WHEN membership_state='independent' THEN 1 ELSE 0 END) AS independent,
      SUM(CASE WHEN membership_state='unknown' THEN 1 ELSE 0 END) AS unknown,
      SUM(CASE WHEN membership_state IS NOT NULL AND membership_state NOT IN ('member','independent','unknown') THEN 1 ELSE 0 END) AS invalid,
      SUM(CASE WHEN membership_team_id IS NULL THEN 1 ELSE 0 END) AS missing_membership_rows,
      SUM(CASE WHEN actual_team_id IS NULL OR active<>1 OR season<>'2026' THEN 1 ELSE 0 END) AS inactive_or_missing_expected_teams,
      SUM(CASE WHEN membership_state='member' AND membership_conference_id IS NULL THEN 1 ELSE 0 END) AS member_without_conference_id,
      SUM(CASE WHEN membership_state IN ('independent','unknown') AND membership_conference_id IS NOT NULL THEN 1 ELSE 0 END) AS nonmember_with_conference_id,
      SUM(CASE WHEN membership_state='member' AND referenced_conference_id IS NULL THEN 1 ELSE 0 END) AS missing_conference_refs,
      SUM(CASE WHEN COALESCE(team_conference_id,'')<>COALESCE(CASE WHEN membership_state='member' THEN membership_conference_id ELSE NULL END,'') THEN 1 ELSE 0 END) AS conference_pointer_mismatches,
      (SELECT COUNT(*) FROM conference_memberships) AS total_membership_rows
    FROM joined
  `).bind(JSON.stringify(expectedIds)).all();
  return { values: result.results?.[0] || {}, d1: { rows_read: num(result.meta?.rows_read), rows_written: num(result.meta?.rows_written) } };
}

function certificationFailures(verification) {
  const v = verification.values || {};
  const checks = [
    ["expected_teams", num(v.expected_teams), LOCKED.active_eligible_teams],
    ["membership_rows", num(v.membership_rows), LOCKED.membership_upserts],
    ["total_membership_rows", num(v.total_membership_rows), LOCKED.membership_upserts],
    ["member", num(v.member), LOCKED.member],
    ["independent", num(v.independent), LOCKED.independent],
    ["unknown", num(v.unknown), LOCKED.unknown],
    ["invalid", num(v.invalid), 0],
    ["missing_membership_rows", num(v.missing_membership_rows), 0],
    ["inactive_or_missing_expected_teams", num(v.inactive_or_missing_expected_teams), 0],
    ["member_without_conference_id", num(v.member_without_conference_id), 0],
    ["nonmember_with_conference_id", num(v.nonmember_with_conference_id), 0],
    ["missing_conference_refs", num(v.missing_conference_refs), 0],
    ["conference_pointer_mismatches", num(v.conference_pointer_mismatches), 0],
    ["verification_rows_written", num(verification.d1?.rows_written), 0]
  ];
  return checks.filter(([, actual, expected]) => actual !== expected).map(([label, actual, expected]) => ({ label, actual, expected }));
}

export async function handleM9ProductionOnce(request, env) {
  const url = new URL(request.url);
  if (url.pathname !== M9_PRODUCTION_ONCE_PATH) return null;
  if (Date.now() > M9_PRODUCTION_EXPIRES_AT) return json({ error: "expired" }, 410);
  if (request.method === "GET") {
    return json({ status: "READY", fingerprint: M9_LOCKED_FINGERPRINT, expires_at: new Date(M9_PRODUCTION_EXPIRES_AT).toISOString() });
  }
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body = {};
  try { body = await request.json(); } catch {}
  if (body?.fingerprint !== M9_LOCKED_FINGERPRINT) return json({ error: "fingerprint_required" }, 409);

  try {
    const existing = await migrationState(env);
    if (existing.rows > 0) return json({ error: "already_populated", existing }, 409);

    const plan = await planStatewideConferenceMembershipPopulation(env);
    assertLockedPlan(plan);

    const migration = await applyMigration0016(env);
    const now = new Date().toISOString();
    const writeResults = await env.DB.batch([
      conferenceUpsert(env, plan.conferences, now),
      membershipUpsert(env, plan.memberships, now),
      teamPointerUpdate(env, plan.memberships, now)
    ]);
    const write = telemetry(writeResults);
    const per_statement_changes = writeResults.map(result => num(result?.meta?.changes ?? result?.changes));
    const data_changes = per_statement_changes.reduce((sum, value) => sum + value, 0);
    if (data_changes > LOCKED.data_write_upper_bound) throw new Error(`data write fuse exceeded: ${data_changes} > ${LOCKED.data_write_upper_bound}`);

    const verification = await verifyProduction(env, plan);
    const failures = certificationFailures(verification);
    const certified = failures.length === 0 && verification.d1.rows_read <= 5000;
    if (verification.d1.rows_read > 5000) failures.push({ label: "verification_rows_read", actual: verification.d1.rows_read, expected_max: 5000 });

    return json({
      status: certified ? "CERTIFIED" : "VERIFICATION_FAILED",
      certified,
      fingerprint: plan.fingerprint,
      plan: {
        active_eligible_teams: plan.active_eligible_teams,
        coverage: plan.coverage,
        planned: plan.planned,
        known_source_gaps: plan.known_source_gaps
      },
      migration: { name: LOCKED.migration, ...migration },
      write: {
        set_based_statements: 3,
        per_statement_changes,
        data_changes,
        rows_read: write.rows_read,
        rows_written: write.rows_written
      },
      verification,
      failures
    }, certified ? 200 : 500);
  } catch (error) {
    return json({ error: "m9_production_operation_failed", message: String(error?.message || error), details: error?.details || null }, 500);
  }
}
