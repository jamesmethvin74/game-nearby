import process from "node:process";
const accountId="588568148fa47810445f37081e49562c";
const buildId="83182fbc-c54b-4dae-96c0-26d727c1178f";
const token=String(process.env.CLOUDFLARE_API_TOKEN||"").trim();
if(!token) process.exit(2);
const response=await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/builds/builds/${buildId}/logs`,{headers:{authorization:`Bearer ${token}`,accept:"application/json"}});
const payload=await response.json();
const lines=payload?.result?.lines;
if(!response.ok||payload?.success!==true||!Array.isArray(lines)) process.exit(2);
const text=JSON.stringify(lines);
if(text.includes("LOGO_BOOTSTRAP_READY attempt=")){
  console.log("SIBLING_LOGO_READY=YES");
  process.exit(0);
}
console.error("SIBLING_LOGO_READY=NO");
process.exit(1);
