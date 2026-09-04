import { execFileSync } from "node:child_process";

const sql = `SELECT
  COUNT(*) AS batch3_runs,
  SUM(CASE WHEN cr.status='SUCCESS' THEN 1 ELSE 0 END) AS success_runs,
  SUM(CASE WHEN cr.status='FAILURE' THEN 1 ELSE 0 END) AS failure_runs,
  SUM(CASE WHEN cr.status='NOT_MODIFIED' THEN 1 ELSE 0 END) AS not_modified_runs,
  SUM(CASE WHEN cr.status='SKIPPED' THEN 1 ELSE 0 END) AS skipped_runs,
  SUM(CASE WHEN cr.status='RUNNING' THEN 1 ELSE 0 END) AS running_runs
FROM collection_runs cr
JOIN sources src ON src.id=cr.source_id
JOIN teams t ON t.id=src.team_id
JOIN schools sch ON sch.id=t.school_id
WHERE sch.level='college'
  AND sch.catalog_scope='local'
  AND t.season='2026'
  AND cr.started_at >= '2026-09-04T16:57:20Z'
  AND cr.started_at < '2026-09-04T16:58:10Z'`;

const raw = execFileSync("wrangler", [
  "d1", "execute", "localbleachersar-sports", "--remote",
  `--command=${sql}`, "--json"
], { encoding:"utf8", stdio:["ignore","pipe","inherit"] });

const parsed = JSON.parse(raw);
const envelopes = Array.isArray(parsed) ? parsed : [parsed];
const row = envelopes.flatMap(item => item?.results || []).find(Boolean);
if (!row) throw new Error("Batch 3 forensic query returned no row");

const result = {
  batch3Runs:Number(row.batch3_runs || 0),
  successRuns:Number(row.success_runs || 0),
  failureRuns:Number(row.failure_runs || 0),
  notModifiedRuns:Number(row.not_modified_runs || 0),
  skippedRuns:Number(row.skipped_runs || 0),
  runningRuns:Number(row.running_runs || 0)
};

console.log(JSON.stringify({ status:"M4_BATCH3_FORENSIC", ...result }));

if (result.batch3Runs !== 0) {
  throw new Error(`Batch 3 reached collection: ${JSON.stringify(result)}`);
}
