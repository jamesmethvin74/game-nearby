#!/usr/bin/env node
import process from "node:process";

const STATE_URL="https://www.rankone.com/districts?state=AR&type=0";

function clean(value=""){
  return String(value)
    .replace(/<[^>]+>/g," ")
    .replace(/&nbsp;/gi," ")
    .replace(/&amp;/gi,"&")
    .replace(/&#39;/g,"'")
    .replace(/&quot;/gi,'"')
    .replace(/\s+/g," ")
    .trim();
}

function absolute(url,base){
  return new URL(String(url).replaceAll("&amp;","&"),base).toString();
}

function anchors(html,base){
  const out=[];
  const re=/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for(const match of String(html).matchAll(re)){
    out.push({url:absolute(match[1],base),text:clean(match[2])});
  }
  return out;
}

function districtLinks(html,base=STATE_URL){
  return anchors(html,base)
    .filter(row=>/app\.rankone\.com\/Schedules\/View_Schedule_All_Web\.aspx/i.test(row.url))
    .filter(row=>/[?&]D=[^&]+/i.test(row.url))
    .filter(row=>/[?&]MT=0(?:&|$)/i.test(row.url))
    .map(row=>({districtName:row.text,districtUrl:row.url}));
}

function schoolLinks(html,base){
  return anchors(html,base)
    .filter(row=>/View_Schedule_All_Web\.aspx/i.test(row.url))
    .filter(row=>/[?&]D=[^&]+/i.test(row.url) && /[?&]S=[^&]+/i.test(row.url))
    .map(row=>({schoolName:row.text,schoolUrl:row.url}));
}

function sectionSlices(html){
  const text=String(html);
  const men=text.search(/>\s*MENS\s*</i);
  const women=text.search(/>\s*WOMENS\s*</i);
  const combined=text.search(/>\s*COMBINED\s*</i);
  return {
    men:men>=0?text.slice(men,women>=0?women:combined>=0?combined:text.length):"",
    women:women>=0?text.slice(women,combined>=0?combined:text.length):""
  };
}

function findSportUrl(section,base,label){
  const match=anchors(section,base).find(row=>row.text.toLowerCase()===label.toLowerCase());
  return match?.url||null;
}

export function parseRankOneSchoolSports(html,schoolUrl){
  const sections=sectionSlices(html);
  return {
    "basketball-boys":findSportUrl(sections.men,schoolUrl,"Basketball"),
    "basketball-girls":findSportUrl(sections.women,schoolUrl,"Basketball"),
    "volleyball-girls":findSportUrl(sections.women,schoolUrl,"Volleyball")
  };
}

async function get(url,fetchFn){
  const response=await fetchFn(url,{
    redirect:"follow",
    headers:{
      "user-agent":"LocalBleachersAR-rankone-discovery/1.0",
      "accept":"text/html,application/xhtml+xml;q=0.9,*/*;q=0.5"
    }
  });
  if(!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return {html:await response.text(),url:response.url||url};
}

export async function discoverArkansasRankOne({fetchFn=fetch,stateUrl=STATE_URL}={}){
  const state=await get(stateUrl,fetchFn);
  const districts=districtLinks(state.html,state.url);
  const schools=[];
  const candidates=[];

  for(const district of districts){
    const districtPage=await get(district.districtUrl,fetchFn);
    for(const school of schoolLinks(districtPage.html,districtPage.url)){
      const schoolPage=await get(school.schoolUrl,fetchFn);
      const sports=parseRankOneSchoolSports(schoolPage.html,schoolPage.url);
      const row={
        districtName:district.districtName,
        districtUrl:district.districtUrl,
        schoolName:school.schoolName,
        schoolUrl:school.schoolUrl,
        sports
      };
      schools.push(row);
      for(const [sportKey,sourceUrl] of Object.entries(sports)){
        if(!sourceUrl) continue;
        candidates.push({
          provider:"rankone-public",
          districtName:district.districtName,
          schoolName:school.schoolName,
          sportKey,
          sourceUrl
        });
      }
    }
  }

  return {
    state:"AR",
    provider:"rankone-public",
    districtCount:districts.length,
    schoolCount:schools.length,
    candidateCount:candidates.length,
    districts,
    schools,
    candidates
  };
}

async function main(){
  const result=await discoverArkansasRankOne();
  process.stdout.write(JSON.stringify({...result,generatedAt:new Date().toISOString()},null,2)+"\n");
}

if(import.meta.url===new URL(`file://${process.argv[1]}`).href) await main();
