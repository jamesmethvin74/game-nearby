import { execFileSync } from "node:child_process";

const sql = `WITH scoped AS (
  SELECT src.id
  FROM sources src
  JOIN teams t ON t.id=src.team_id
  JOIN schools sch ON sch.id=t.school_id
  WHERE src.enabled=1
    AND t.active=1
    AND t.season='2026'
    AND sch.level='college'
    AND sch.catalog_scope='local'
), game_counts AS (
  SELECT g.source_id, COUNT(*) AS game_count
  FROM games g
  JOIN scoped s ON s.id=g.source_id
  GROUP BY g.source_id
)
SELECT
  COUNT(*) AS enabled_sources,
  SUM(CASE WHEN COALESCE(gc.game_count,0)>0 THEN 1 ELSE 0 END) AS populated_sources,
  SUM(CASE WHEN COALESCE(gc.game_count,0)=0 THEN 1 ELSE 0 END) AS zero_game_sources,
  SUM(COALESCE(gc.game_count,0)) AS game_rows
FROM scoped s
LEFT JOIN game_counts gc ON gc.source_id=s.id`;

const raw = execFileSync("wrangler", [
  "d1", "execute", "localbleachersar-sports", "--remote",
  `--command=${sql}`, "--json"
], { encoding:"utf8", stdio:["ignore","pipe","inherit"] });

const parsed = JSON.parse(raw);
const envelopes = Array.isArray(parsed) ? parsed : [parsed];
const row = envelopes.flatMap(item => item?.results || []).find(Boolean);
if (!row) throw new Error("Post-Batch 2 population query returned no row");

const result = {
  enabledSources:Number(row.enabled_sources || 0),
  populatedSources:Number(row.populated_sources || 0),
  zeroGameSources:Number(row.zero_game_sources || 0),
  gameRows:Number(row.game_rows || 0)
};

console.log(JSON.stringify({ status:"M4_POST_BATCH2_POPULATION", ...result }));

if (result.enabledSources !== 103) {
  throw new Error(`Expected 103 enabled active local-college sources, got ${result.enabledSources}`);
}
if (result.populatedSources + result.zeroGameSources !== result.enabledSources) {
  throw new Error(`Population partition mismatch: ${JSON.stringify(result)}`);
}
if (result.gameRows < 1) {
  throw new Error(`Expected existing college game rows: ${JSON.stringify(result)}`);
}
if (result.zeroGameSources < 1) {
  throw new Error(`No zero-game sources remain: ${JSON.stringify(result)}`);
}
