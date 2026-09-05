import { spawnSync } from "node:child_process";

function loadInsights(sortBy) {
  const result = spawnSync("wrangler", [
    "d1", "insights", "localbleachersar-sports",
    "--timePeriod=1h",
    "--sort-type=sum",
    `--sort-by=${sortBy}`,
    "--limit=100",
    "--json"
  ], { encoding:"utf8", env:process.env, maxBuffer:20*1024*1024 });

  if (result.status !== 0) {
    console.error(`FINAL_VERIFY_MARKER_PROBE_ERROR sort=${sortBy} status=${String(result.status)}`);
    process.exit(2);
  }
  const text = String(result.stdout || "").trim();
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end < start) {
    console.error(`FINAL_VERIFY_MARKER_PROBE_ERROR sort=${sortBy} reason=no_json_array`);
    process.exit(2);
  }
  try {
    const parsed = JSON.parse(text.slice(start, end + 1));
    if (!Array.isArray(parsed)) throw new Error("not_array");
    return parsed;
  } catch {
    console.error(`FINAL_VERIFY_MARKER_PROBE_ERROR sort=${sortBy} reason=invalid_json`);
    process.exit(2);
  }
}

const queries = [];
for (const sortBy of ["reads", "writes", "count", "time"]) {
  for (const row of loadInsights(sortBy)) queries.push(String(row?.query || "").toLowerCase());
}

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
