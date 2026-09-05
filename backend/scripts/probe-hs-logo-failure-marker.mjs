import process from "node:process";
import { execFileSync } from "node:child_process";
import { encodeMissingMask } from "./statewide-logo-audit-mask.mjs";

const accountId = "588568148fa47810445f37081e49562c";
const workerName = "localbleachersar-sports-api";
const token = String(process.env.CLOUDFLARE_API_TOKEN || "").trim();
if (!token) process.exit(2);
const headers = { authorization: `Bearer ${token}`, accept: "application/json" };

const listResponse = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${workerName}/versions?per_page=20`, { headers });
const listPayload = await listResponse.json();
const versions = Array.isArray(listPayload?.result?.items) ? listPayload.result.items : [];
if (!listResponse.ok || !listPayload?.success || versions.length === 0) process.exit(2);

let result = null;
for (const version of versions) {
  const id = String(version?.id || "");
  if (!id) continue;
  const detailResponse = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/workers/${workerName}/versions/${id}?include=modules`, { headers });
  const detailPayload = await detailResponse.json();
  if (!detailResponse.ok || !detailPayload?.success) continue;
  const modules = Array.isArray(detailPayload?.result?.modules) ? detailPayload.result.modules : [];
  const decoded = modules.map(module => {
    try { return Buffer.from(String(module?.content_base64 || ""), "base64").toString("utf8"); }
    catch { return ""; }
  }).join("\n");
  if (!decoded.includes("logo-bootstrap-result") || !decoded.includes("const RESULT=")) continue;
  const start = decoded.indexOf("const RESULT=") + "const RESULT=".length;
  const end = decoded.indexOf(";\nexport default", start);
  if (end < start) continue;
  try {
    const parsed = JSON.parse(decoded.slice(start, end));
    if (Number(parsed?.totalSchools) === 336 && Number(parsed?.missingCount) === 68 && Array.isArray(parsed?.missingLogos)) {
      result = parsed;
      break;
    }
  } catch {}
}
if (!result) {
  console.error("FINAL_LOGO_RESULT_JSON_NOT_FOUND");
  process.exit(1);
}

const missingIds = result.missingLogos.map(row => String(row?.id || "")).filter(Boolean);
if (missingIds.length !== 68) {
  console.error(`MISSING_LOGO_RESULT_LENGTH_${missingIds.length}`);
  process.exit(1);
}
const { count, encoded } = encodeMissingMask(JSON.stringify(missingIds));
if (count !== 68) {
  console.error(`MISSING_LOGO_MASK_COUNT_${count}`);
  process.exit(1);
}
const alias = `m-${encoded}`;
console.log(`MISSING_LOGO_MASK count=${count} alias=${alias}`);
execFileSync("wrangler", ["versions", "upload", "src/logo-bootstrap-worker.js", "--preview-alias", alias, "--keep-vars"], { stdio: "inherit" });
