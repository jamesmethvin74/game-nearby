import { execFileSync } from "node:child_process";

const sql = `SELECT
  COUNT(*) AS collection_runs,
  COUNT(DISTINCT cr.source_id) AS distinct_sources,
  SUM(CASE WHEN cr.status='SUCCESS' THEN 1 ELSE 0 END) AS successful_runs,
  SUM(CASE WHEN cr.status='FAILURE' THEN 1 ELSE 0 END) AS failed_runs
FROM collection_runs cr
JOIN sources src ON src.id=cr.source_id
JOIN teams t ON t.id=src.team_id
JOIN schools sch ON sch.id=t.school_id
WHERE sch.level='college'
  AND sch.catalog_scope='local'
  AND t.season='2026'
  AND cr.started_at >= '2026-09-04T15:43:30Z'
  AND cr.started_at <  '2026-09-04T15:44:10Z'`;

const raw = execFileSync("wrangler", [
  "d1", "execute", "localbleachersar-sports", "--remote",
  `--command=${sql}`, "--json"
], { encoding:"utf8", stdio:["ignore","pipe","inherit"] });

const parsed = JSON.parse(raw);
const envelopes = Array.isArray(parsed) ? parsed : [parsed];
const row = envelopes.flatMap(item => item?.results || []).find(Boolean);
if (!row) throw new Error("Batch 2 v2 forensic query returned no row");

const result = {
  collectionRuns: Number(row.collection_runs || 0),
  distinctSources: Number(row.distinct_sources || 0),
  successfulRuns: Number(row.successful_runs || 0),
  failedRuns: Number(row.failed_runs || 0)
};

console.log(JSON.stringify({ status:"M4_BATCH2_V2_FORENSIC", ...result }));

// A green forensic build means the failed v2 execution never reached collection.
// Any collection row deliberately fails the build so Batch 2 cannot be retried blindly.
if (result.collectionRuns !== 0) {
  throw new Error(`Batch 2 v2 reached collection: ${JSON.stringify(result)}`);
}
