import process from "node:process";
import { execFileSync } from "node:child_process";

const accountId = "588568148fa47810445f37081e49562c";
const workerName = "localbleachersar-sports-api";
const token = String(process.env.CLOUDFLARE_API_TOKEN || "").trim();
if (!token) process.exit(2);
const headers = { authorization: `Bearer ${token}`, accept: "application/json" };

const listResponse = await fetch(
  `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${workerName}/versions?per_page=20`,
  { headers }
);
const listPayload = await listResponse.json();
const versions = Array.isArray(listPayload?.result) ? listPayload.result : [];
if (!listResponse.ok || !listPayload?.success || versions.length === 0) process.exit(2);

let source = "";
let resultVersion = "";
for (const version of versions) {
  const id = String(version?.id || "");
  if (!id) continue;
  const detailResponse = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/workers/${workerName}/versions/${id}?include=modules`,
    { headers }
  );
  const detailPayload = await detailResponse.json();
  if (!detailResponse.ok || !detailPayload?.success) continue;
  const modules = Array.isArray(detailPayload?.result?.modules) ? detailPayload.result.modules : [];
  const decoded = modules.map(module => {
    try { return Buffer.from(String(module?.content_base64 || ""), "base64").toString("utf8"); }
    catch { return ""; }
  }).join("\n");
  if (decoded.includes("logo-bootstrap-result") && decoded.includes("totalSchools") && decoded.includes("missingCount")) {
    source = decoded;
    resultVersion = id;
    break;
  }
}
if (!source) {
  console.error("FINAL_LOGO_RESULT_VERSION_NOT_FOUND");
  process.exit(1);
}

const numberFor = key => {
  const match = source.match(new RegExp(`["']?${key}["']?\\s*:\\s*(\\d+)`));
  return match ? Number(match[1]) : null;
};
const total = numberFor("totalSchools");
const high = numberFor("highSchools");
const college = numberFor("colleges");
const withLogo = numberFor("schoolsWithLogo");
const missing = numberFor("missingCount");
if ([total, high, college, withLogo, missing].some(value => value === null)) {
  console.error(`FINAL_LOGO_RESULT_COUNTS_NOT_FOUND version=${resultVersion}`);
  process.exit(1);
}

const alias = `r-${total}-${high}-${college}-${withLogo}-${missing}`;
console.log(`FINAL_LOGO_COUNTS version=${resultVersion} alias=${alias}`);
execFileSync("wrangler", [
  "versions", "upload", "src/logo-bootstrap-worker.js",
  "--preview-alias", alias,
  "--keep-vars"
], { stdio: "inherit" });
