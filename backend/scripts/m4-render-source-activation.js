import fs from "node:fs";
import {
  COLLEGE_SOURCE_ACTIVATE_SQL,
  collegeProductionActivationPlan
} from "../src/college-production-activation.js";

const season = "2026";
const plan = collegeProductionActivationPlan(season);

const expected = {
  schools: 36,
  teams: 130,
  ready: 103,
  inactive: 27,
  sourceRows: 103
};

for (const [key, value] of Object.entries(expected)) {
  if (Number(plan.counts[key]) !== value) {
    throw new Error(`M4 activation denominator mismatch ${key}: ${plan.counts[key]} != ${value}`);
  }
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

let sql = COLLEGE_SOURCE_ACTIVATE_SQL;
for (const payload of [plan.sourceRows, plan.teams]) {
  const marker = sql.indexOf("?");
  if (marker < 0) throw new Error("Missing SQL bind marker while rendering M4 source activation");
  sql = `${sql.slice(0, marker)}${sqlLiteral(JSON.stringify(payload))}${sql.slice(marker + 1)}`;
}

if (sql.includes("?")) throw new Error("Unexpected extra SQL bind marker in M4 source activation");

const normalized = sql.replace(/\s+/g, " ").trim().toLowerCase();
if (!normalized.includes("update sources set enabled = case")) {
  throw new Error("M4 source activation must contain exactly the scoped sources UPDATE");
}
for (const forbidden of [
  "insert into",
  "insert or",
  "delete from",
  "update teams",
  "update games",
  "update canonical_events",
  "update team_records",
  "update standings",
  "drop table",
  "alter table"
]) {
  if (normalized.includes(forbidden)) throw new Error(`Forbidden production mutation in M4 activation: ${forbidden}`);
}

fs.writeFileSync(".m4-source-activate.sql", `${sql.trim()};\n`, "utf8");
console.log(JSON.stringify({
  status: "M4_SOURCE_ACTIVATION_RENDERED",
  season,
  teams: plan.counts.teams,
  ready: plan.counts.ready,
  inactive: plan.counts.inactive,
  sourceRows: plan.counts.sourceRows
}));
