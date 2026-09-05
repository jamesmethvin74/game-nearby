import process from "node:process";
const accountId="588568148fa47810445f37081e49562c";
const buildId="484e6342-1698-48fc-8e70-5fece815a86f";
const token=String(process.env.CLOUDFLARE_API_TOKEN||"").trim();
if(!token) process.exit(2);
const response=await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/builds/builds/${buildId}/logs`,{headers:{authorization:`Bearer ${token}`,accept:"application/json"}});
const payload=await response.json();
const lines=payload?.result?.lines;
if(!response.ok||payload?.success!==true||!Array.isArray(lines)) process.exit(2);
const text=JSON.stringify(lines);
if(text.includes("HS_LOGO_SECRET_INSTALLED attempt=")){
  console.log("HS_LOGO_V3_SECRET_INSTALLED=YES");
  process.exit(0);
}
console.error("HS_LOGO_V3_SECRET_INSTALLED=NO");
process.exit(1);
