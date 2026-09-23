#!/usr/bin/env node
import fs from "node:fs";
import process from "node:process";
import {
  OFFICIAL_SCHOOL_RESULT_SPORTS,
  officialSchoolSportPath
} from "../src/official-school-source-catalog.js";

function normalizeBaseUrl(value){
  const url=new URL(String(value).trim());
  if(url.protocol!=="https:" && url.protocol!=="http:") throw new Error("candidate URL must be http(s)");
  url.pathname="/"; url.search=""; url.hash="";
  return url.toString().replace(/\/$/,"");
}

function mascotSignature(text){
  return /MASCOT\s+MEDIA/i.test(text) || /mascotmedia\.net/i.test(text);
}

async function probe(url,{fetchFn=fetch}={}){
  const response=await fetchFn(url,{
    redirect:"follow",
    headers:{
      "user-agent":"LocalBleachersAR-official-source-discovery/1.0",
      "accept":"text/html,application/xhtml+xml;q=0.9,*/*;q=0.5"
    }
  });
  const body=await response.text();
  return {url:response.url||url,status:response.status,ok:response.ok,mascot:mascotSignature(body)};
}

export async function discoverOfficialSchoolCandidate(baseUrl,{fetchFn=fetch}={}){
  const base=normalizeBaseUrl(baseUrl);
  const home=await probe(base,{fetchFn});
  const sports={};
  for(const key of OFFICIAL_SCHOOL_RESULT_SPORTS){
    const result=await probe(base+officialSchoolSportPath(key),{fetchFn});
    sports[key]={
      status:result.status,
      ok:result.ok,
      mascot:result.mascot,
      url:result.url
    };
  }
  const mascot=home.mascot || Object.values(sports).some(row=>row.mascot);
  const supportedSports=Object.entries(sports).filter(([,row])=>row.ok&&row.mascot).map(([key])=>key);
  return {
    baseUrl:base,
    provider:mascot?"mascot-media":"unknown",
    homeStatus:home.status,
    supportedSports,
    ready:mascot && supportedSports.length>0,
    sports
  };
}

async function main(){
  const file=process.argv[2];
  if(!file){
    console.error("usage: node scripts/discover-official-school-result-sources.mjs <candidate-urls.txt>");
    process.exitCode=2;
    return;
  }
  const candidates=fs.readFileSync(file,"utf8").split(/\r?\n/).map(v=>v.trim()).filter(v=>v&&!v.startsWith("#"));
  const results=[];
  for(const candidate of [...new Set(candidates)]){
    try { results.push(await discoverOfficialSchoolCandidate(candidate)); }
    catch(error){ results.push({baseUrl:candidate,ready:false,error:String(error?.message||error)}); }
  }
  process.stdout.write(JSON.stringify({
    generatedAt:new Date().toISOString(),
    candidateCount:candidates.length,
    readyCount:results.filter(row=>row.ready).length,
    results
  },null,2)+"\n");
}

if(import.meta.url===new URL(`file://${process.argv[1]}`).href) await main();
