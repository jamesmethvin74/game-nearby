import process from "node:process";
const accountId="588568148fa47810445f37081e49562c";
const buildId="366e8b0a-193d-414b-b730-adf605977023";
const token=String(process.env.CLOUDFLARE_API_TOKEN||"").trim();
if(!token) process.exit(2);
const response=await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/builds/builds/${buildId}/logs`,{headers:{authorization:`Bearer ${token}`,accept:"application/json"}});
const payload=await response.json();
const lines=payload?.result?.lines;
if(!response.ok||payload?.success!==true||!Array.isArray(lines)) process.exit(2);
const text=JSON.stringify(lines);
if(text.includes("HS_LOGO_READY attempt=")){
  console.log("HS_LOGO_V2_READY_PRESENT");
  process.exit(0);
}
console.error("HS_LOGO_V2_READY_ABSENT");
process.exit(1);
