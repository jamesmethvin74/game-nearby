import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { matchMaxPrepsBranding } from "../src/school-branding.js";
import { SBLIVE_ARKANSAS_SCHOOLS, parseSBLiveSchoolDirectory, parseSBLiveSchoolLogo } from "../src/sblive-school-logo.js";
import { AUDIT_MISSING_IDS, encodeMissingMask } from "./statewide-logo-audit-mask.mjs";

const missing68=Buffer.from("00000000f09db6e82293ed4de71fedc9ebeb02","hex");
const recoveredMasks=["aaaaaaaarqicqauamaeaefibjaaiaaa","aaaaaaaqaasaaaaaaaaiaabaafbacaa","aaaaaaaaaaaaaaaaaaaaaaaeaaaaaaa"];
function decodeBase32(value){const alphabet="abcdefghijklmnopqrstuvwxyz234567";let bits=0,acc=0;const out=[];for(const ch of value){const n=alphabet.indexOf(ch);if(n<0)throw new Error(`bad base32 ${ch}`);acc=(acc<<5)|n;bits+=5;if(bits>=8){out.push((acc>>>(bits-8))&255);bits-=8;}}return Buffer.from(out);}
const recovered=recoveredMasks.map(decodeBase32);const isSet=(bytes,i)=>(((bytes[Math.floor(i/8)]||0)>>(i%8))&1)===1;
const remainingIds=AUDIT_MISSING_IDS.filter((id,i)=>isSet(missing68,i)&&!recovered.some(mask=>isSet(mask,i)));
if(remainingIds.length!==39||remainingIds.some(id=>!id.startsWith("aaa-")))throw new Error(`Expected exact 39 AAA IDs, got ${remainingIds.length}`);
const reconciliation=JSON.parse(fs.readFileSync("data/arkansas-high-school-production-reconciliation.json","utf8"));
const byId=new Map((reconciliation.aaa_certified_schools_not_in_production||[]).map(row=>[`aaa-${String(row.aaa_id).toLowerCase()}`,row]));
const schools=remainingIds.map(id=>{const row=byId.get(id);if(!row)throw new Error(`Missing reconciliation row ${id}`);return{id,name:row.school_name,location_matched_name:null,city:"",state:"AR",level:"high-school"};});
const directoryResponse=await fetch(SBLIVE_ARKANSAS_SCHOOLS,{headers:{"user-agent":"LocalBleachersAR-sblive-logo-probe/1.0",accept:"text/html"},redirect:"follow"});
if(!directoryResponse.ok)throw new Error(`SBLive directory HTTP ${directoryResponse.status}`);
const entries=parseSBLiveSchoolDirectory(await directoryResponse.text());
console.log(`SBLIVE_LOGO_DIRECTORY entries=${entries.length}`);
const matches=matchMaxPrepsBranding(entries,schools,[]).matches;const bySchool=new Map();for(const match of matches)if(!bySchool.has(match.schoolId))bySchool.set(match.schoolId,match.entry);
console.log(`SBLIVE_LOGO_MATCHES ${bySchool.size}/39`);
const results=await Promise.all(remainingIds.map(async id=>{const school=schools.find(row=>row.id===id);const entry=bySchool.get(id);if(!entry)return{id,ok:false,reason:"no-sblive-school"};try{const response=await fetch(entry.sourceUrl,{headers:{"user-agent":"LocalBleachersAR-sblive-logo-probe/1.0",accept:"text/html"},redirect:"follow"});if(!response.ok)return{id,ok:false,reason:`HTTP ${response.status}`,sourceUrl:entry.sourceUrl};const logo=parseSBLiveSchoolLogo(await response.text(),response.url||entry.sourceUrl,{name:school.name,sourceName:entry.name});if(!logo?.logoUrl)return{id,ok:false,reason:"no-confident-sblive-logo",sourceUrl:entry.sourceUrl};return{id,ok:true,sourceUrl:entry.sourceUrl,...logo};}catch(error){return{id,ok:false,reason:String(error?.message||error),sourceUrl:entry.sourceUrl};}}));
const covered=results.filter(row=>row.ok).map(row=>row.id);for(const row of results)console.log(`SBLIVE_LOGO_RESULT id=${row.id} ok=${row.ok} reason=${row.reason||row.method||"ok"}`);const{count,encoded}=encodeMissingMask(JSON.stringify(covered));if(count!==covered.length)throw new Error(`coverage mask mismatch ${count} != ${covered.length}`);console.log(`SBLIVE_LOGO_TOTAL covered=${covered.length} unresolved=${39-covered.length}`);execFileSync("wrangler",["versions","upload","src/logo-bootstrap-worker.js","--preview-alias",`s-${encoded}`,"--keep-vars"],{stdio:"inherit"});