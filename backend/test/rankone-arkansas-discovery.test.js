import test from "node:test";
import assert from "node:assert/strict";
import {
  discoverArkansasRankOne,
  parseRankOneSchoolSports
} from "../scripts/discover-rankone-arkansas-result-sources.mjs";

test("Rank One school parser finds boys/girls basketball and girls volleyball",()=>{
  const html=`
    <h2>MENS</h2>
    <a href="/Schedules/View_Schedule_Web.aspx?X=1">Basketball</a>
    <a href="/Schedules/View_Schedule_Web.aspx?X=2">Football</a>
    <h2>WOMENS</h2>
    <a href="/Schedules/View_Schedule_Web.aspx?X=3">Basketball</a>
    <a href="/Schedules/View_Schedule_Web.aspx?X=4">Volleyball</a>
    <h2>COMBINED</h2>
  `;
  const sports=parseRankOneSchoolSports(html,"https://app.rankone.com/Schedules/View_Schedule_All_Web.aspx?D=d&S=s");
  assert.match(sports["basketball-boys"],/X=1/);
  assert.match(sports["basketball-girls"],/X=3/);
  assert.match(sports["volleyball-girls"],/X=4/);
});

test("Arkansas discovery walks state -> district -> school and emits all supported sport candidates",async()=>{
  const stateUrl="https://www.rankone.com/districts?state=AR&type=0";
  const districtUrl="https://app.rankone.com/Schedules/View_Schedule_All_Web.aspx?D=abc&MT=0";
  const schoolUrl="https://app.rankone.com/Schedules/View_Schedule_All_Web.aspx?D=abc&P=0&S=123";
  const pages=new Map([
    [stateUrl,`<a href="${districtUrl}">Example District</a>`],
    [districtUrl,`<a href="${schoolUrl}">Example High School</a>`],
    [schoolUrl,`
      <h2>MENS</h2>
      <a href="/Schedules/View_Schedule_Web.aspx?B=1">Basketball</a>
      <h2>WOMENS</h2>
      <a href="/Schedules/View_Schedule_Web.aspx?B=2">Basketball</a>
      <a href="/Schedules/View_Schedule_Web.aspx?V=1">Volleyball</a>
      <h2>COMBINED</h2>
    `]
  ]);
  const fetchFn=async url=>{
    const body=pages.get(String(url));
    if(body==null) return new Response("not found",{status:404});
    return new Response(body,{status:200,headers:{"content-type":"text/html"}});
  };
  const result=await discoverArkansasRankOne({fetchFn,stateUrl});
  assert.equal(result.districtCount,1);
  assert.equal(result.schoolCount,1);
  assert.equal(result.candidateCount,3);
  assert.deepEqual(
    result.candidates.map(row=>row.sportKey).sort(),
    ["basketball-boys","basketball-girls","volleyball-girls"]
  );
});
