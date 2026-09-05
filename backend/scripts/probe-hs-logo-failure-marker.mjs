import { execFileSync } from "node:child_process";

const resultUrl = "https://logo-bootstrap-exec-localbleachersar-sports-api.james-methvin74.workers.dev/logo-bootstrap-result";
const response = await fetch(resultUrl, { headers: { accept: "application/json", "cache-control": "no-store" } });
if (!response.ok) {
  console.error(`FINAL_LOGO_RESULT_HTTP_${response.status}`);
  process.exit(1);
}
const result = await response.json();

const total = Number(result?.totalSchools);
const high = Number(result?.highSchools);
const college = Number(result?.colleges);
const withLogo = Number(result?.schoolsWithLogo);
const missing = Number(result?.missingCount);
if (![total, high, college, withLogo, missing].every(Number.isFinite)) {
  console.error("FINAL_LOGO_RESULT_COUNTS_INVALID");
  process.exit(1);
}

const alias = `r-${total}-${high}-${college}-${withLogo}-${missing}`;
console.log(`FINAL_LOGO_COUNTS alias=${alias}`);
execFileSync("wrangler", [
  "versions", "upload", "src/logo-bootstrap-worker.js",
  "--preview-alias", alias,
  "--keep-vars"
], { stdio: "inherit" });
