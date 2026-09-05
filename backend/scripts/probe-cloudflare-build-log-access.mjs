import process from "node:process";

const accountId = "588568148fa47810445f37081e49562c";
const buildId = "56d4965d-50b0-4b22-819b-23accd805b9b";
const token = String(process.env.CLOUDFLARE_API_TOKEN || "").trim();

if (!token) {
  console.error("BUILD_LOG_ACCESS_FAIL reason=no_cloudflare_api_token_env");
  process.exit(1);
}

const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/builds/builds/${buildId}/logs`, {
  headers: { authorization: `Bearer ${token}`, accept: "application/json" }
});
let payload = null;
try {
  payload = await response.json();
} catch {
  console.error(`BUILD_LOG_ACCESS_FAIL http=${response.status} reason=non_json_response`);
  process.exit(1);
}

const lines = payload?.result?.lines;
if (!response.ok || payload?.success !== true || !Array.isArray(lines)) {
  console.error(`BUILD_LOG_ACCESS_FAIL http=${response.status} api_success=${String(payload?.success)}`);
  process.exit(1);
}

console.log(`BUILD_LOG_ACCESS_OK lines=${lines.length} truncated=${String(Boolean(payload?.result?.truncated))}`);
