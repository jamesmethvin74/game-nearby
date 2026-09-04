import fs from "node:fs";
import path from "node:path";
import {
  COLLEGE_SOURCE_PREPARE_SQL,
  COLLEGE_TEAM_ACTIVATION_SQL,
  collegeProductionActivationPlan
} from "../src/college-production-activation.js";
import { COLLEGE_SCHOOL_INSERT_SQL, COLLEGE_TEAM_INSERT_SQL } from "../src/college-catalog.js";

const SEASON = "2026";
const OUTPUT = path.resolve(".m4-production-prepare.sql");
const plan = collegeProductionActivationPlan(SEASON);

const expected = { schools:36, teams:130, ready:103, inactive:27, sourceRows:103 };
for (const [key, value] of Object.entries(expected)) {
  if (Number(plan.counts[key]) !== value) {
    throw new Error(`M4 production prep count mismatch ${key}: ${plan.counts[key]} != ${value}`);
  }
}

function literal(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function bindSql(sql, values) {
  let index = 0;
  const rendered = sql.replace(/\?/g, () => {
    if (index >= values.length) throw new Error("M4 production prep SQL placeholder underflow");
    return literal(values[index++]);
  });
  if (index !== values.length) throw new Error("M4 production prep SQL placeholder overflow");
  return rendered.trim();
}

const statements = [
  bindSql(COLLEGE_SCHOOL_INSERT_SQL, [JSON.stringify(plan.schools)]),
  bindSql(COLLEGE_TEAM_INSERT_SQL, [JSON.stringify(plan.teams)]),
  bindSql(COLLEGE_TEAM_ACTIVATION_SQL, [JSON.stringify(plan.certifiedTargets), JSON.stringify(plan.teams)]),
  bindSql(COLLEGE_SOURCE_PREPARE_SQL, [JSON.stringify(plan.sourceRows)])
];

if (statements.length !== 4) throw new Error(`Unexpected M4 prep statement count ${statements.length}`);

const sql = statements.join(";\n\n") + ";\n";

if (/\bUPDATE\s+sources\b/i.test(sql)) {
  throw new Error("M4 production prep must not activate or update source rows");
}
if (/\b(?:INSERT|UPDATE|DELETE)\s+(?:OR\s+IGNORE\s+)?(?:INTO\s+)?(?:games|canonical_events|canonical_event_members|team_records|standings)\b/i.test(sql)) {
  throw new Error("M4 production prep must not mutate schedules, canonical events, records, or standings");
}
if (/college-bootstrap|COLLEGE_SOURCE_ACTIVATE_SQL/i.test(sql)) {
  throw new Error("M4 production prep contains a forbidden activation/bootstrap marker");
}

fs.writeFileSync(OUTPUT, sql, "utf8");
console.log(`Rendered bounded M4 production prep: ${JSON.stringify(expected)}`);
