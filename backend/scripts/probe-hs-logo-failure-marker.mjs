import process from "node:process";
import { execFileSync } from "node:child_process";

const accountId = "588568148fa47810445f37081e49562c";
const buildId = "d9d2c1d8-c0af-4c6e-960f-5d3cb480de27";
const token = String(process.env.CLOUDFLARE_API_TOKEN || "").trim();
if (!token) process.exit(2);

const response = await fetch(
  `https://api.cloudflare.com/client/v4/accounts/${accountId}/builds/builds/${buildId}/logs`,
  { headers: { authorization: `Bearer ${token}`, accept: "application/json" } }
);
const payload = await response.json();
const lines = payload?.result?.lines;
if (!response.ok || payload?.success !== true || !Array.isArray(lines)) process.exit(2);

const strings = [];
const collect = value => {
  if (typeof value === "string") strings.push(value);
  else if (Array.isArray(value)) for (const item of value) collect(item);
  else if (value && typeof value === "object") for (const item of Object.values(value)) collect(item);
};
collect(lines);
const text = strings.join("\n");

const number = key => {
  const match = text.match(new RegExp(`"${key}":(\\d+)`));
  return match ? Number(match[1]) : null;
};
const total = number("totalSchools");
const high = number("highSchools");
const college = number("colleges");
const withLogo = number("schoolsWithLogo");
const missing = number("missingCount");
if ([total, high, college, withLogo, missing].some(value => value === null)) {
  console.error("FINAL_LOGO_COUNTS_NOT_PARSEABLE");
  process.exit(1);
}

const alias = `r-${total}-${high}-${college}-${withLogo}-${missing}`;
console.log(`FINAL_LOGO_COUNTS alias=${alias}`);
execFileSync("wrangler", [
  "versions", "upload", "src/logo-bootstrap-worker.js",
  "--preview-alias", alias,
  "--keep-vars"
], { stdio: "inherit" });
