import { spawnSync } from "node:child_process";

const result = spawnSync("wrangler", [
  "d1", "insights", "localbleachersar-sports",
  "--timePeriod=1h",
  "--sort-type=sum",
  "--sort-by=reads",
  "--limit=100",
  "--json"
], { encoding:"utf8", env:process.env, maxBuffer:10*1024*1024 });

if (result.status !== 0) {
  console.error(`D1_INSIGHTS_ACCESS_FAIL status=${String(result.status)}`);
  process.exit(1);
}
const text = String(result.stdout || "").trim();
const start = text.indexOf("[");
const end = text.lastIndexOf("]");
if (start < 0 || end < start) {
  console.error("D1_INSIGHTS_ACCESS_FAIL reason=no_json_array");
  process.exit(1);
}
let rows;
try {
  rows = JSON.parse(text.slice(start, end + 1));
} catch {
  console.error("D1_INSIGHTS_ACCESS_FAIL reason=invalid_json");
  process.exit(1);
}
if (!Array.isArray(rows)) {
  console.error("D1_INSIGHTS_ACCESS_FAIL reason=not_array");
  process.exit(1);
}
console.log(`D1_INSIGHTS_ACCESS_OK rows=${rows.length}`);
