import test from "node:test";
import assert from "node:assert/strict";
import { parseMaxPrepsVolleyballScores,maxPrepsScoresUrl } from "../src/maxpreps-volleyball-results.js";
import {
  VOLLEYBALL_CONVERGENCE_BATCH_KEY,
  VOLLEYBALL_CONVERGENCE_BATCHES,
  runVolleyballConvergenceBatch
} from "../src/volleyball-convergence-batch.js";

function fakeD1({opponentNowLocal=false}={}) {
  const targets=[
    {team_id:"df-ezw3f9-volleyball-2026",school_name:"Marion High School"},
    {team_id:"df-26g9fq-volleyball-2026",school_name:"Columbia Christian School"},
    {team_id:"df-kybtet-volleyball-2026",school_name:"Magnolia High School"}
  ];
  const locals=[...targets,{team_id:"other",school_name:opponentNowLocal?"Collierville":"Conway High School"}];
  return {
    prepare(sql){
      let args=[];
      return {
        bind(...next){args=next;return this;},
        async all(){
          assert.ok(args.length===0 || Array.isArray(JSON.parse(args[0])));
          return {results:sql.includes("json_each(?)")?targets:locals};
        }
      };
    }
  };
}

function card({contestId,homeId,homeName,homeScore,awayId,awayName,awayScore}) {
  return `<li class="c" data-teams="${homeId},${awayId}" data-contest-id="${contestId}"><div class="contest-box-item" data-contest-state="boxscore"><a href="https://www.maxpreps.com/ar/volleyball/match/test/?c=${contestId}" class="c-c"><ul class="teams"><li><div class="score">${homeScore}</div><div class="name">${homeName}</div></li><li><div class="score">${awayScore}</div><div class="name">${awayName}</div></li></ul><div class="details"> Final</div></a></div></li>`;
}

function sourcePage({includeAll=true}={}) {
  const contests=[
    {contestId:"bf452b95-43e9-412c-8bbc-80fcd92ca147",homeId:"marion",homeName:"Marion",homeScore:3,awayId:"collierville",awayName:"Collierville",awayScore:1},
    {contestId:"01c9d8e3-fdea-4c12-879b-6a9f9726bb58",homeId:"columbia",homeName:"Columbia Christian",homeScore:3,awayId:"word",awayName:"Word of God Academy",awayScore:1},
    {contestId:"b3ba2de8-200c-412e-923e-7bad05699fd2",homeId:"magnolia",homeName:"Magnolia",homeScore:1,awayId:"pleasant",awayName:"Pleasant Grove",awayScore:3},
    {contestId:"unapproved-same-day",homeId:"marion",homeName:"Marion",homeScore:3,awayId:"other",awayName:"Other Academy",awayScore:0}
  ];
  const selected=includeAll?contests:contests.slice(0,2);
  const options=new Map();
  for(const row of selected) {
    options.set(row.homeId,row.homeName);
    options.set(row.awayId,row.awayName);
  }
  return `<!doctype html><html><body><select id="q_n_teams">${[...options].map(([id,name])=>`<option value="${id}">${name}</option>`).join("")}</select><ul>${selected.map(card).join("")}</ul></body></html>`;
}

test("approved volleyball convergence batch is locked to three exact contests",()=>{
  const batch=VOLLEYBALL_CONVERGENCE_BATCHES[VOLLEYBALL_CONVERGENCE_BATCH_KEY];
  assert.deepEqual(batch.dates,["2026-08-24"]);
  assert.deepEqual(batch.contests.map(row=>row.contestId),[
    "bf452b95-43e9-412c-8bbc-80fcd92ca147",
    "01c9d8e3-fdea-4c12-879b-6a9f9726bb58",
    "b3ba2de8-200c-412e-923e-7bad05699fd2"
  ]);
});

test("bounded convergence strips an unapproved same-day final before the writer sees the page",async()=>{
  const env={DB:fakeD1()};
  let runnerCalls=0;
  const runner=async (_env,opts)=>{
    runnerCalls++;
    assert.deepEqual(opts.dates,["2026-08-24"]);
    assert.deepEqual(new Set(opts.targetTeamIds),new Set([
      "df-ezw3f9-volleyball-2026",
      "df-26g9fq-volleyball-2026",
      "df-kybtet-volleyball-2026"
    ]));
    const response=await opts.fetchFn(maxPrepsScoresUrl("2026-08-24"),{});
    const html=await response.text();
    const finals=parseMaxPrepsVolleyballScores(html,{localDate:"2026-08-24"});
    assert.equal(finals.length,3);
    assert.deepEqual(new Set(finals.map(row=>row.contestId)),new Set([
      "bf452b95-43e9-412c-8bbc-80fcd92ca147",
      "01c9d8e3-fdea-4c12-879b-6a9f9726bb58",
      "b3ba2de8-200c-412e-923e-7bad05699fd2"
    ]));
    assert.ok(!html.includes("unapproved-same-day"));
    return {status:"SUCCESS",matchedFinals:3,observations:3,touchedTeams:3,writes:12};
  };
  const fetchFn=async()=>new Response(sourcePage(),{status:200});
  const result=await runVolleyballConvergenceBatch(env,{batchKey:VOLLEYBALL_CONVERGENCE_BATCH_KEY,fetchFn,runner});
  assert.equal(runnerCalls,1);
  assert.equal(result.preflight.targetTeams,3);
  assert.equal(result.result.matchedFinals,3);
});

test("bounded convergence aborts before writer work if an approved contest disappears",async()=>{
  const env={DB:fakeD1()};
  let writerReached=false;
  const runner=async (_env,opts)=>{
    await opts.fetchFn(maxPrepsScoresUrl("2026-08-24"),{});
    writerReached=true;
    return {status:"SUCCESS",matchedFinals:0,observations:0,touchedTeams:0};
  };
  await assert.rejects(
    runVolleyballConvergenceBatch(env,{batchKey:VOLLEYBALL_CONVERGENCE_BATCH_KEY,fetchFn:async()=>new Response(sourcePage({includeAll:false}),{status:200}),runner}),
    /missing an approved contest/
  );
  assert.equal(writerReached,false);
});

test("bounded convergence aborts if an approved external opponent has become a local Arkansas team",async()=>{
  const env={DB:fakeD1({opponentNowLocal:true})};
  let runnerCalls=0;
  await assert.rejects(
    runVolleyballConvergenceBatch(env,{batchKey:VOLLEYBALL_CONVERGENCE_BATCH_KEY,runner:async()=>{runnerCalls++;}}),
    /opponent is now local/
  );
  assert.equal(runnerCalls,0);
});
