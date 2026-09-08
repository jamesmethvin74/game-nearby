import test from "node:test";
import assert from "node:assert/strict";
import { parseMaxPrepsVolleyballScores,maxPrepsScoresUrl } from "../src/maxpreps-volleyball-results.js";
import { VOLLEYBALL_CONVERGENCE_BATCH_KEY,VOLLEYBALL_CONVERGENCE_BATCHES,runVolleyballConvergenceBatch } from "../src/volleyball-convergence-batch.js";

function fakeD1({opponentNowLocal=false,conferenceMembership=false}={}){
  const targets=[
    {team_id:"df-ezw3f9-volleyball-2026",school_name:"Marion High School",conference_id:conferenceMembership?"unexpected":null},
    {team_id:"df-26g9fq-volleyball-2026",school_name:"Columbia Christian School",conference_id:null},
    {team_id:"df-kybtet-volleyball-2026",school_name:"Magnolia High School",conference_id:null}
  ];
  const locals=[...targets,{team_id:"other",school_name:opponentNowLocal?"Collierville":"Conway High School"}];
  return {prepare(sql){let args=[];return {bind(...next){args=next;return this;},async all(){return {results:sql.includes("json_each(?)")?targets:locals};}};}};
}
function card(r){return `<li class="c" data-teams="${r.homeId},${r.awayId}" data-contest-id="${r.contestId}"><div class="contest-box-item" data-contest-state="boxscore"><a href="https://www.maxpreps.com/ar/volleyball/match/test/?c=${r.contestId}" class="c-c"><ul class="teams"><li><div class="score">${r.homeScore}</div><div class="name">${r.homeName}</div></li><li><div class="score">${r.awayScore}</div><div class="name">${r.awayName}</div></li></ul><div class="details"> Final</div></a></div></li>`;}
function sourcePage(){const rows=[
  {contestId:"bf452b95-43e9-412c-8bbc-80fcd92ca147",homeId:"marion",homeName:"Marion",homeScore:3,awayId:"collierville",awayName:"Collierville",awayScore:1},
  {contestId:"01c9d8e3-fdea-4c12-879b-6a9f9726bb58",homeId:"columbia",homeName:"Columbia Christian",homeScore:3,awayId:"word",awayName:"Word of God Academy",awayScore:1},
  {contestId:"b3ba2de8-200c-412e-923e-7bad05699fd2",homeId:"magnolia",homeName:"Magnolia",homeScore:1,awayId:"pleasant",awayName:"Pleasant Grove",awayScore:3},
  {contestId:"unapproved",homeId:"marion",homeName:"Marion",homeScore:3,awayId:"other",awayName:"Other Academy",awayScore:0}
];const opts=new Map();for(const r of rows){opts.set(r.homeId,r.homeName);opts.set(r.awayId,r.awayName);}return `<!doctype html><html><body><select id="q_n_teams">${[...opts].map(([id,n])=>`<option value="${id}">${n}</option>`).join("")}</select><ul>${rows.map(card).join("")}</ul></body></html>`;}

test("v3 batch is locked to exactly three Aug 24 contests",()=>{
  const b=VOLLEYBALL_CONVERGENCE_BATCHES[VOLLEYBALL_CONVERGENCE_BATCH_KEY];
  assert.deepEqual(b.dates,["2026-08-24"]); assert.equal(b.contests.length,3);
});

test("v3 strips same-day unapproved finals before collector writes",async()=>{
  let calls=0;
  const result=await runVolleyballConvergenceBatch({DB:fakeD1()},{batchKey:VOLLEYBALL_CONVERGENCE_BATCH_KEY,fetchFn:async()=>new Response(sourcePage(),{status:200}),runner:async(_env,opts)=>{
    calls++; const response=await opts.fetchFn(maxPrepsScoresUrl("2026-08-24"),{}); const html=await response.text();
    const finals=parseMaxPrepsVolleyballScores(html,{localDate:"2026-08-24"}); assert.equal(finals.length,3); assert.ok(!html.includes("unapproved"));
    return {status:"SUCCESS",matchedFinals:3,observations:3,touchedTeams:3,recordResult:{standings:{cohorts:0}}};
  }});
  assert.equal(calls,1); assert.equal(result.preflight.targetTeams,3);
});

test("v3 fails closed if opponent becomes local or target joins a conference",async()=>{
  await assert.rejects(runVolleyballConvergenceBatch({DB:fakeD1({opponentNowLocal:true})},{batchKey:VOLLEYBALL_CONVERGENCE_BATCH_KEY,runner:async()=>{throw new Error("writer reached");}}),/opponent is now local/);
  await assert.rejects(runVolleyballConvergenceBatch({DB:fakeD1({conferenceMembership:true})},{batchKey:VOLLEYBALL_CONVERGENCE_BATCH_KEY,runner:async()=>{throw new Error("writer reached");}}),/target now has conference membership/);
});
