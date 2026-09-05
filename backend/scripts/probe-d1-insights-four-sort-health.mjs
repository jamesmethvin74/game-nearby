import { spawnSync } from "node:child_process";

for (const sortBy of ["reads", "writes", "count", "time"]) {
  const result = spawnSync("wrangler", [
    "d1", "insights", "localbleachersar-sports",
    "--timePeriod=1h",
    "--sort-type=sum",
    `--sort-by=${sortBy}`,
    "--limit=100",
    "--json"
  ], { encoding:"utf8", env:process.env, maxBuffer:20*1024*1024 });

  if (result.status !== 0) {
    console.error(`D1_INSIGHTS_HEALTH_FAIL sort=${sortBy} status=${String(result.status)}`);
    process.exit(1);
  }
  const text = String(result.stdout || "").trim();
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end < start) {
    console.error(`D1_INSIGHTS_HEALTH_FAIL sort=${sortBy} reason=no_json_array`);
    process.exit(1);
  }
  let rows;
  try {
    rows = JSON.parse(text.slice(start, end + 1));
  } catch {
    console.error(`D1_INSIGHTS_HEALTH_FAIL sort=${sortBy} reason=invalid_json`);
    process.exit(1);
  }
  if (!Array.isArray(rows) || !rows.some(row => typeof row?.query === "string" && row.query.trim().length > 0)) {
    console.error(`D1_INSIGHTS_HEALTH_FAIL sort=${sortBy} reason=no_query_strings`);
    process.exit(1);
  }
}

console.log("D1_INSIGHTS_FOUR_SORT_HEALTH_OK");
