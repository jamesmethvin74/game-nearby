import { normalizeSchoolAlias } from "./schedule-authority-core.js";

function clean(value) { return String(value ?? "").replace(/\s+/g, " ").trim(); }
function decodeHtml(value) { return clean(value).replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&nbsp;/g," "); }
function attr(attrs,name){const m=String(attrs||"").match(new RegExp(`\\b${name}=(?:"([^"]*)"|'([^']*)')`,"i"));return decodeHtml(m?.[1]??m?.[2]??"");}
function stripTags(value){return decodeHtml(String(value||"").replace(/<[^>]+>/g," "));}
function titleCaseSlug(slug){return String(slug||"").split("-").filter(Boolean).map(w=>w.charAt(0).toUpperCase()+w.slice(1)).join(" ");}
export const SBLIVE_ARKANSAS_SCHOOLS = "https://www.si.com/high-school/stats/arkansas/schools";
export function parseSBLiveSchoolDirectory(html) {
  const rows=[],seen=new Set();
  for(const m of String(html||"").matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)){
    const href=attr(m[1],"href"); const match=href.match(/\/high-school\/stats\/arkansas\/schools\/(\d+)-([a-z0-9-]+)(?:[/?#]|$)/i); if(!match)continue;
    const schoolId=match[1],slug=match[2].toLowerCase(); if(seen.has(schoolId))continue;
    const label=stripTags(m[2]); let name=label,city=""; const loc=label.match(/^(.*?)(?:\s+)([A-Za-z .'-]+),\s*AR$/i); if(loc){name=clean(loc[1]);city=clean(loc[2]);}
    if(!name||name.length>100)name=titleCaseSlug(slug); seen.add(schoolId);
    rows.push({externalSchoolId:schoolId,name,city,location:city?`${city}, AR`:"",logoUrl:"",sourceUrl:`https://www.si.com/high-school/stats/arkansas/schools/${schoolId}-${slug}`});
  } return rows;
}
function pageSchoolId(pageUrl){return String(pageUrl||"").match(/\/schools\/(\d+)-/i)?.[1]||"";}
function normalizeEmbeddedText(html){return String(html||"").replace(/\\u002F/gi,"/").replace(/\\\//g,"/").replace(/&amp;/g,"&").replace(/\\u0026/gi,"&");}
function schoolTokens(hints={}){const stop=new Set(["high","school","schools","academy","district","arkansas","ar","k","12"]);return[...new Set([hints.name,hints.sourceName].flatMap(v=>normalizeSchoolAlias(v).split(/\s+/)).filter(t=>t&&t.length>2&&!stop.has(t)))];}
export function parseSBLiveSchoolLogo(html,pageUrl,hints={}){
  const schoolId=pageSchoolId(pageUrl); if(!schoolId)return null; const text=normalizeEmbeddedText(html); const prefix=`https://assets.scorebooklive.com/r/uploads/production/school/${schoolId}/image/`; const found=[],seen=new Set(); const escaped=prefix.replace(/[.*+?^${}()|[\]\\]/g,"\\$&"); const re=new RegExp(`${escaped}[^"'\\s<>?]+(?:\\?[^"'\\s<>]*)?`,"gi");
  for(const m of text.matchAll(re)){let url=m[0].replace(/&quot;.*$/i,"");try{url=new URL(url).toString();}catch{continue;}if(seen.has(url))continue;seen.add(url);const lower=decodeURIComponent(url).toLowerCase();let score=50;if(/logo|mascot|crest|emblem/.test(lower))score+=50;if(schoolTokens(hints).some(t=>lower.includes(t)))score+=20;if(/banner|cover|hero|team_photo|team-photo|gallery/.test(lower))score-=60;found.push({url,score});}
  found.sort((a,b)=>b.score-a.score); if(!found.length)return null; if(found.length>1&&found[0].score===found[1].score&&found[0].url!==found[1].url)return null; if(found[0].score<50)return null; return{logoUrl:found[0].url,method:"sblive-school-asset",confidence:found[0].score>=100?1:0.8};
}
