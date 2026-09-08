import process from "node:process";

const accountId="588568148fa47810445f37081e49562c";
const buildId="a3a3dbc7-52ce-44c9-9520-e4ad498b5e55";
const token=String(process.env.CLOUDFLARE_API_TOKEN||"").trim();
const probe=String(process.argv[2]||"").trim();
const patterns={
  secret:/AUG24_VOLLEYBALL_SECRET_INSTALLED attempt=/,
  ready:/AUG24_VOLLEYBALL_READY attempt=/,
  result:/AUG24_VOLLEYBALL_CONVERGENCE_RESULT=/,
  postFailed:/Approved volleyball convergence POST failed:/,
  preflightTarget:/Bounded volleyball convergence target-team preflight failed/,
  identityChanged:/Bounded volleyball convergence local identity changed/,
  conferenceMembership:/Bounded volleyball convergence target now has conference membership/,
  opponentLocal:/Bounded volleyball convergence opponent is now local/,
  sourceMissing:/Bounded volleyball convergence source page is missing an approved contest/,
  pairingChanged:/Bounded volleyball convergence pairing changed/,
  verified:/AUG24_VOLLEYBALL_CONVERGENCE_VERIFIED/
};
if(!token || !patterns[probe]) process.exit(2);
const response=await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/builds/builds/${buildId}/logs`,{
  headers:{authorization:`Bearer ${token}`,accept:"application/json"}
});
const payload=await response.json();
const lines=payload?.result?.lines;
if(!response.ok||payload?.success!==true||!Array.isArray(lines)) process.exit(2);
const text=JSON.stringify(lines);
if(patterns[probe].test(text)){
  console.log(`AUG24_BUILD_PROBE_${probe.toUpperCase()}=PRESENT`);
  process.exit(0);
}
console.error(`AUG24_BUILD_PROBE_${probe.toUpperCase()}=ABSENT`);
process.exit(1);
