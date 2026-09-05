import process from "node:process";

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

const required = [
  "STATEWIDE_LOGO_RESULT_READY",
  '"status":"COMPLETE"',
  '"totalSchools":336',
  '"highSchools":300',
  '"colleges":36',
  '"schoolsWithLogo":336',
  '"missingCount":0'
];
const missing = required.filter(marker => !text.includes(marker));
if (missing.length) {
  console.error(`STATEWIDE_LOGO_TARGET_NOT_CONFIRMED missingMarkers=${missing.join(",")}`);
  process.exit(1);
}
console.log("STATEWIDE_LOGO_TARGET_CONFIRMED total=336 highSchools=300 colleges=36 logos=336 missing=0");
