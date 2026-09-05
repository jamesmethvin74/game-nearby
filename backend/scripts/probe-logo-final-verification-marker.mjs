import { spawnSync } from "node:child_process";

const result = spawnSync("wrangler", [
  "d1", "insights", "localbleachersar-sports",
  "--timePeriod=1h",
  "--sort-type=sum",
  "--sort-by=count",
  "--limit=1000",
  "--json"
], { encoding:"utf8", env:process.env, maxBuffer:20*1024*1024 });

if (result.status !== 0) {
  console.error(`FINAL_VERIFY_MARKER_PROBE_ERROR status=${String(result.status)}`);
  process.exit(2);
}
const text = String(result.stdout || "").trim();
const start = text.indexOf("[");
const end = text.lastIndexOf("]");
if (start < 0 || end < start) {
  console.error("FINAL_VERIFY_MARKER_PROBE_ERROR reason=no_json_array");
  process.exit(2);
}
let rows;
try {
  rows = JSON.parse(text.slice(start, end + 1));
} catch {
  console.error("FINAL_VERIFY_MARKER_PROBE_ERROR reason=invalid_json");
  process.exit(2);
}
const queries = (Array.isArray(rows) ? rows : []).map(row => String(row?.query || "").toLowerCase());
const found = queries.some(query =>
  query.includes("as total_schools") &&
  query.includes("as high_schools") &&
  query.includes("as colleges") &&
  query.includes("as schools_with_logo") &&
  query.includes("as missing_logos")
);

if (found) {
  console.log("FINAL_VERIFY_MARKER_PRESENT");
  process.exit(0);
}
console.error("FINAL_VERIFY_MARKER_ABSENT");
process.exit(1);
