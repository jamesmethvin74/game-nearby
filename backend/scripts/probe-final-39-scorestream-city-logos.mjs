import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { matchMaxPrepsBranding } from "../src/school-branding.js";
import { parseMaxPrepsSchoolLinks } from "../src/maxpreps-school-page-logo.js";
import { parseScoreStreamCityTeams, parseScoreStreamTeamLogo } from "../src/scorestream-school-logo.js";
import { AUDIT_MISSING_IDS, encodeMissingMask } from "./statewide-logo-audit-mask.mjs";

const MAXPREPS_DIRS=["https://www.maxpreps.com/ar/schools/","https://www.maxpreps.com/ar/football/schools/","https://www.maxpreps.com/ar/basketball/schools/","https://www.maxpreps.com/ar/volleyball/schools/","https://www.maxpreps.com/ar/cross-country/schools/","https://www.maxpreps.com/ar/soccer/girls/schools/"];
const missing68=Buffer.from("00000000f09db6e82293ed4de71fedc9ebeb02","hex"),recoveredMasks=["aaaaaaaarqicqauamaeaefibjaaiaaa","aaaaaaaqaasaaaaaaaaiaabaafbacaa","aaaaaaaaaaaaaaaaaaaaaaaeaaaaaaa"];
function decodeBase32(value){const alphabet="abcdefghijklmnopqrstuvwxyz234567";let bits=0,acc=0;const out=[];for(const ch of value){const n=alphabet.indexOf(ch);if(n<0)throw new Error(`bad base32 ${ch}`);acc=(acc<<5)|n;bits+=5;if(bits>=8){out.push((acc>>>(bits-8))&255);bits-=8;}}return Buffer.from(out);}
const recovered=recoveredMasks.map(decodeBase32),isSet=(bytes,i)=>(((bytes[Math.floor(i/8)]||0)>>(i%8))&1)===1;
const remainingIds=AUDIT_MISSING_IDS.filter((id,i)=>isSet(missing68,i)&&!recovered.some(mask=>isSet(mask,i)));if(remainingIds.length!==39)throw new Error(`Expected 39, got ${remainingIds.length}`);
const reconciliation=JSON.parse(fs.readFileSync("data/arkansas-high-school-production-reconciliation.json","utf8")),byId=new Map((reconciliation.aaa_certified_schools_not_in_production||[]).map(row=>[`aaa-${String(row.aaa_id).toLowerCase()}`,row]));
const schools=remainingIds.map(id=>{const row=byId.get(id);if(!row)throw new Error(`Missing ${id}`);return{id,name:row.school_name,location_matched_name:null,city:"",state:"AR",level:"high-school"};});

const maxprepsResults=await Promise.all(MAXPREPS_DIRS.map(async sourceUrl=>{try{const response=await fetch(sourceUrl,{headers:{"user-agent":"LocalBleachersAR-scorestream-logo-probe/1.0",accept:"text/html"},redirect:"follow"});if(!response.ok)throw new Error(`HTTP ${response.status}`);return{links:parseMaxPrepsSchoolLinks(await response.text()),error:null};}catch(error){return{links:[],error:String(error?.message||error)};}}));
const mpLinks=[],mpSeen=new Set();for(const row of maxprepsResults)for(const link of row.links){const key=`${link.name}|${link.city}|${link.sourceUrl}`;if(mpSeen.has(key))continue;mpSeen.add(key);mpLinks.push(link);}
const mpMatches=matchMaxPrepsBranding(mpLinks,schools,[]).matches,cityBySchool=new Map();for(const match of mpMatches)if(!cityBySchool.has(match.schoolId))cityBySchool.set(match.schoolId,match.entry.city);
console.log(`SCORESTREAM_CITY_RESOLVED ${cityBySchool.size}/39`);

const uniqueCities=[...new Set([...cityBySchool.values()].filter(Boolean))].sort();
const cityResults=await Promise.all(uniqueCities.map(async city=>{const url=`https://scorestream.com/c/browse/teams?city=${encodeURIComponent(city)}&state=AR`;try{const response=await fetch(url,{headers:{"user-agent":"LocalBleachersAR-scorestream-logo-probe/1.0",accept:"text/html"},redirect:"follow"});if(!response.ok)throw new Error(`HTTP ${response.status}`);return{city,entries:parseScoreStreamCityTeams(await response.text(),city),error:null};}catch(error){return{city,entries:[],error:String(error?.message||error)};}}));
const allTeams=cityResults.flatMap(row=>row.entries);console.log(`SCORESTREAM_CITY_PAGES cities=${uniqueCities.length} teams=${allTeams.length} failures=${cityResults.filter(r=>r.error).length}`);
const schoolsWithCity=schools.map(s=>({...s,city:cityBySchool.get(s.id)||""}));
const teamMatches=matchMaxPrepsBranding(allTeams,schoolsWithCity,[]).matches,teamBySchool=new Map();for(const match of teamMatches)if(!teamBySchool.has(match.schoolId))teamBySchool.set(match.schoolId,match.entry);
console.log(`SCORESTREAM_TEAM_MATCHES ${teamBySchool.size}/39`);

const results=await Promise.all(remainingIds.map(async id=>{const school=schoolsWithCity.find(r=>r.id===id),entry=teamBySchool.get(id);if(!entry)return{id,ok:false,reason:"no-scorestream-team"};try{const response=await fetch(entry.sourceUrl,{headers:{"user-agent":"LocalBleachersAR-scorestream-logo-probe/1.0",accept:"text/html"},redirect:"follow"});if(!response.ok)return{id,ok:false,reason:`HTTP ${response.status}`,sourceUrl:entry.sourceUrl};const logo=parseScoreStreamTeamLogo(await response.text(),response.url||entry.sourceUrl,{name:school.name,sourceName:entry.name});if(!logo?.logoUrl)return{id,ok:false,reason:"no-confident-scorestream-logo",sourceUrl:entry.sourceUrl};return{id,ok:true,sourceUrl:entry.sourceUrl,...logo};}catch(error){return{id,ok:false,reason:String(error?.message||error),sourceUrl:entry.sourceUrl};}}));
const covered=results.filter(r=>r.ok).map(r=>r.id);for(const row of results)console.log(`SCORESTREAM_LOGO_RESULT id=${row.id} ok=${row.ok} reason=${row.reason||row.method||"ok"}`);const{count,encoded}=encodeMissingMask(JSON.stringify(covered));if(count!==covered.length)throw new Error(`mask mismatch ${count}/${covered.length}`);console.log(`SCORESTREAM_LOGO_TOTAL covered=${covered.length} unresolved=${39-covered.length}`);execFileSync("wrangler",["versions","upload","src/logo-bootstrap-worker.js","--preview-alias",`q-${encoded}`,"--keep-vars"],{stdio:"inherit"});