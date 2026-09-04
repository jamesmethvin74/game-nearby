import { spawnSync } from "node:child_process";

const result = spawnSync("wrangler", [
  "d1", "execute", "localbleachersar-sports",
  "--remote",
  "--command=SELECT COUNT(*) AS n FROM schools WHERE id='ecclesia'",
  "--json"
], { encoding:"utf8", maxBuffer:512 * 1024 });

if (result.status !== 0) {
  process.stderr.write(result.stderr || result.stdout || "M4 rollback probe failed\n");
  process.exit(result.status || 1);
}

const payload = JSON.parse(result.stdout || "[]");
const row = payload?.[0]?.results?.[0] || {};
const n = Number(row.n ?? -1);
const meta = payload?.[0]?.meta || {};
console.log(`M4_ROLLBACK_PROBE ${JSON.stringify({ ecclesia:n, rowsRead:Number(meta.rows_read || 0), rowsWritten:Number(meta.rows_written || 0) })}`);

if (Number(meta.rows_written || 0) !== 0) throw new Error("Rollback probe unexpectedly wrote rows");
if (n !== 0) throw new Error(`M4 prep appears committed: ecclesia=${n}`);
