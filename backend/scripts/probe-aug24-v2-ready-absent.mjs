import process from "node:process";

const accountId="588568148fa47810445f37081e49562c";
const buildId="43cb765c-4764-427a-936d-620a47c62087";
const token=String(process.env.CLOUDFLARE_API_TOKEN||"").trim();
if(!token) process.exit(2);

const response=await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/builds/builds/${buildId}/logs`,{
  headers:{authorization:`Bearer ${token}`,accept:"application/json"}
});
const payload=await response.json();
const lines=payload?.result?.lines;
if(!response.ok||payload?.success!==true||!Array.isArray(lines)) process.exit(2);
const text=JSON.stringify(lines);
if(/AUG24_V2_READY attempt=/.test(text)) {
  console.error("AUG24_V2_READY_PRESENT");
  process.exit(1);
}
console.log("AUG24_V2_READY_ABSENT=CONFIRMED");
