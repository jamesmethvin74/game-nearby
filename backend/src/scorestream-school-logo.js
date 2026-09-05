import { normalizeSchoolAlias } from "./schedule-authority-core.js";

function clean(value){return String(value??"").replace(/\s+/g," ").trim();}
function decodeHtml(value){return clean(value).replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&nbsp;/g," ");}
function attr(attrs,name){const m=String(attrs||"").match(new RegExp(`\\b${name}=(?:"([^"]*)"|'([^']*)')`,"i"));return decodeHtml(m?.[1]??m?.[2]??"");}
function stripTags(value){return decodeHtml(String(value||"").replace(/<[^>]+>/g," "));}
function absolute(value,base){try{const u=new URL(decodeHtml(value),base);return /^https?:$/.test(u.protocol)?u.toString():"";}catch{return"";}}

export function parseScoreStreamCityTeams(html,city=""){
  const rows=[],seen=new Set();
  for(const m of String(html||"").matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)){
    const href=attr(m[1],"href");
    const tm=href.match(/\/team\/([a-z0-9-]+)-(\d+)(?:[/?#]|$)/i);if(!tm)continue;
    const id=tm[2],slug=tm[1];if(seen.has(id))continue;
    let label=stripTags(m[2]);
    label=label.replace(/\bHigh School\b.*$/i,"").replace(/\bFollow\d*\s*Fans?\b.*$/i,"").trim();
    if(!label||label.length>120)label=slug.split("-").map(w=>w.charAt(0).toUpperCase()+w.slice(1)).join(" ");
    seen.add(id);rows.push({externalSchoolId:id,name:label,city,location:city?`${city}, AR`:"",logoUrl:"",sourceUrl:`https://scorestream.com/team/${slug}-${id}`});
  }
  return rows;
}

function schoolTokens(hints={}){const stop=new Set(["high","school","schools","academy","district","arkansas","ar","k","12"]);return[...new Set([hints.name,hints.sourceName].flatMap(v=>normalizeSchoolAlias(v).split(/\s+/)).filter(t=>t&&t.length>2&&!stop.has(t)))];}
function imageScore({url,label,className,id},tokens){const hay=`${label} ${className} ${id} ${url}`.toLowerCase();let score=0;if(/\blogo\b|\bmascot\b|\bcrest\b|\bemblem\b/.test(hay))score+=80;if(tokens.some(t=>hay.includes(t)))score+=25;if(/scorestream.*logo|app.?store|google.?play|avatar|profile.?pic|post|photo|video|sponsor|advert/.test(hay)&&!/\bteam.?logo\b|\bmascot\b/.test(hay))score-=100;return score;}
export function parseScoreStreamTeamLogo(html,pageUrl,hints={}){
  const candidates=[],seen=new Set(),tokens=schoolTokens(hints);
  const add=(raw,meta={})=>{const url=absolute(raw,pageUrl);if(!url||seen.has(url))return;seen.add(url);const score=imageScore({url,...meta},tokens);if(score>=80)candidates.push({url,score});};
  for(const m of String(html||"").matchAll(/<img\b([^>]*)>/gi)){const attrs=m[1],meta={label:attr(attrs,"alt")||attr(attrs,"title")||attr(attrs,"aria-label"),className:attr(attrs,"class"),id:attr(attrs,"id")};for(const key of ["src","data-src","data-original"])add(attr(attrs,key),meta);const ss=attr(attrs,"srcset")||attr(attrs,"data-srcset");if(ss)for(const item of ss.split(","))add(item.trim().split(/\s+/)[0],meta);}
  const normalized=String(html||"").replace(/\\u002F/gi,"/").replace(/\\\//g,"/");
  for(const m of normalized.matchAll(/https?:\/\/[^"'\s<>]+/gi)){const raw=m[0];if(/logo|mascot|team.*image|team.*logo/i.test(raw))add(raw,{label:"",className:"",id:""});}
  candidates.sort((a,b)=>b.score-a.score);if(!candidates.length)return null;if(candidates.length>1&&candidates[0].score===candidates[1].score&&candidates[0].url!==candidates[1].url)return null;return{logoUrl:candidates[0].url,method:"scorestream-team-logo",confidence:1};
}
