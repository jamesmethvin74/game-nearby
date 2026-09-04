import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  COLLEGE_SOURCE_PREPARE_SQL,
  COLLEGE_TEAM_ACTIVATION_SQL,
  collegeProductionActivationPlan
} from "../src/college-production-activation.js";
import { COLLEGE_SCHOOL_INSERT_SQL, COLLEGE_TEAM_INSERT_SQL } from "../src/college-catalog.js";

const DATABASE = "localbleachersar-sports";
const SEASON = "2026";
const plan = collegeProductionActivationPlan(SEASON);

const expected = { schools:36, teams:130, ready:103, inactive:27, sourceRows:103 };
for (const [key, value] of Object.entries(expected)) {
  if (Number(plan.counts[key]) !== value) throw new Error(`M4 production-prep count mismatch ${key}: ${plan.counts[key]} != ${value}`);
}

function literal(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function bindSql(sql, values) {
  let index = 0;
  const rendered = sql.replace(/\?/g, () => {
    if (index >= values.length) throw new Error("M4 production-prep SQL placeholder underflow");
    return literal(values[index++]);
  });
  if (index !== values.length) throw new Error("M4 production-prep SQL placeholder overflow");
  return rendered.trim();
}

const sql = [
  "PRAGMA foreign_keys = ON",
  bindSql(COLLEGE_SCHOOL_INSERT_SQL, [JSON.stringify(plan.schools)]),
  bindSql(COLLEGE_TEAM_INSERT_SQL, [JSON.stringify(plan.teams)]),
  bindSql(COLLEGE_TEAM_ACTIVATION_SQL, [JSON.stringify(plan.certifiedTargets), JSON.stringify(plan.teams)]),
  bindSql(COLLEGE_SOURCE_PREPARE_SQL, [JSON.stringify(plan.sourceRows)])
].join(";\n\n") + ";\n";

if (/UPDATE\s+sources\s+SET\s+enabled/i.test(sql)) throw new Error("Source activation SQL is forbidden in M4 preparation");
if (/\b(?:INSERT|UPDATE|DELETE)\s+(?:OR\s+IGNORE\s+)?(?:INTO\s+)?(?:games|canonical_events|canonical_event_members|team_records|standings)\b/i.test(sql)) {
  throw new Error("Schedule/result mutation SQL is forbidden in M4 preparation");
}

const file = path.join(os.tmpdir(), `localbleachersar-m4-prepare-${process.pid}.sql`);
fs.writeFileSync(file, sql, "utf8");

try {
  const result = spawnSync("wrangler", [
    "d1", "execute", DATABASE,
    "--remote",
    `--file=${file}`,
    "--yes",
    "--json"
  ], { encoding:"utf8", maxBuffer:10 * 1024 * 1024 });

  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout || "M4 D1 preparation failed\n");
    process.exit(result.status || 1);
  }

  const payload = JSON.parse(result.stdout || "[]");
  const meta = payload?.[0]?.meta || {};
  const summary = {
    status:"PREPARED_DISABLED",
    season:SEASON,
    ...expected,
    rowsRead:Number(meta.rows_read || 0),
    rowsWritten:Number(meta.rows_written || 0),
    durationMs:Number(meta.duration || 0) || null,
    queries:Number(payload?.[0]?.results?.[0]?.["Total queries executed"] || 0) || null
  };
  console.log(`M4_PRODUCTION_PREP_RESULT ${JSON.stringify(summary)}`);
} finally {
  fs.rmSync(file, { force:true });
}
