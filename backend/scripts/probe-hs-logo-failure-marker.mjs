import process from "node:process";
const accountId="588568148fa47810445f37081e49562c";
const buildId="2a359a57-5bd9-4677-8baf-c3a03799a7c9";
const token=String(process.env.CLOUDFLARE_API_TOKEN||"").trim();
if(!token) process.exit(2);
const response=await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/builds/builds/${buildId}/logs`,{headers:{authorization:`Bearer ${token}`,accept:"application/json"}});
const payload=await response.json();
const lines=payload?.result?.lines;
if(!response.ok||payload?.success!==true||!Array.isArray(lines)) process.exit(2);
const text=JSON.stringify(lines);
if(text.includes("Logo bootstrap readiness attempt")){
  console.log("STATEWIDE_READINESS_LOOP_ENTERED=YES");
  process.exit(0);
}
console.error("STATEWIDE_READINESS_LOOP_ENTERED=NO");
process.exit(1);
