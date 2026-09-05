import process from "node:process";
const accountId="588568148fa47810445f37081e49562c";
const buildId="9ff23032-a5cc-4f0a-8fe4-41e523b572c0";
const token=String(process.env.CLOUDFLARE_API_TOKEN||"").trim();
if(!token) process.exit(2);
const response=await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/builds/builds/${buildId}/logs`,{headers:{authorization:`Bearer ${token}`,accept:"application/json"}});
const payload=await response.json();
const lines=payload?.result?.lines;
if(!response.ok||payload?.success!==true||!Array.isArray(lines)) process.exit(2);
const text=JSON.stringify(lines);
if(text.includes("curl: (")){
  console.log("HS_LOGO_FAILURE_CLASS=CURL_TRANSPORT");
  process.exit(0);
}
console.error("HS_LOGO_FAILURE_CLASS=NOT_CURL_TRANSPORT");
process.exit(1);
