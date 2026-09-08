import test from "node:test";
import assert from "node:assert/strict";
import { parseMaxPrepsVolleyballScores,maxPrepsScoresUrl } from "../src/maxpreps-volleyball-results.js";
import {
  VOLLEYBALL_CONVERGENCE_AUDIT_RUN_ID,
  VOLLEYBALL_CONVERGENCE_BATCH_KEY,
  VOLLEYBALL_CONVERGENCE_BATCHES,
  VOLLEYBALL_CONVERGENCE_SNAPSHOT_PROVIDER,
  runVolleyballConvergenceBatch
} from "../src/volleyball-convergence-batch.js";

function fakeD1({opponentNowLocal=false,conferenceMembership=false}={}){
  const targets=[
    {team_id:"df-ezw3f9-volleyball-2026",school_name:"Marion High School",conference_id:conferenceMembership?"unexpected":null},
    {team_id:"df-26g9fq-volleyball-2026",school_name:"Columbia Christian School",conference_id:null},
    {team_id:"df-kybtet-volleyball-2026",school_name:"Magnolia High School",conference_id:null}
  ];
  const locals=[...targets,{team_id:"other",school_name:opponentNowLocal?"Collierville":"Conway High School"}];
  return {prepare(sql){return {bind(){return this;},async all(){return {results:sql.includes("json_each(?)")?targets:locals};}};}};
}

test("approved batch is locked to the exact audited Aug 24 snapshot",()=>{
  const b=VOLLEYBALL_CONVERGENCE_BATCHES[VOLLEYBALL_CONVERGENCE_BATCH_KEY];
  assert.equal(VOLLEYBALL_CONVERGENCE_AUDIT_RUN_ID,34172135818);
  assert.deepEqual(b.dates,["2026-08-24"]);
  assert.deepEqual(b.contests.map(row=>({contestId:row.contestId,home:row.home.name,homeScore:row.home.score,away:row.away.name,awayScore:row.away.score})),[
    {contestId:"bf452b95-43e9-412c-8bbc-80fcd92ca147",home:"Marion",homeScore:3,away:"Collierville",awayScore:1},
    {contestId:"01c9d8e3-fdea-4c12-879b-6a9f9726bb58",home:"Columbia Christian",homeScore:3,away:"Word of God Academy",awayScore:1},
    {contestId:"b3ba2de8-200c-412e-923e-7bad05699fd2",home:"Magnolia",homeScore:1,away:"Pleasant Grove",awayScore:3}
  ]);
});

test("approved batch sends only the frozen three-final snapshot to the collector",async()=>{
  let calls=0;
  const result=await runVolleyballConvergenceBatch({DB:fakeD1()},{batchKey:VOLLEYBALL_CONVERGENCE_BATCH_KEY,runner:async(_env,opts)=>{
    calls++;
    assert.equal(opts.opponentIdentityProvider,VOLLEYBALL_CONVERGENCE_SNAPSHOT_PROVIDER);
    assert.deepEqual(opts.dates,["2026-08-24"]);
    assert.deepEqual(new Set(opts.targetTeamIds),new Set([
      "df-ezw3f9-volleyball-2026",
      "df-26g9fq-volleyball-2026",
      "df-kybtet-volleyball-2026"
    ]));
    const response=await opts.fetchFn(maxPrepsScoresUrl("2026-08-24"),{});
    const finals=parseMaxPrepsVolleyballScores(await response.text(),{localDate:"2026-08-24"});
    assert.deepEqual(finals.map(row=>({contestId:row.contestId,home:row.home.name,homeScore:row.home.score,away:row.away.name,awayScore:row.away.score})),[
      {contestId:"bf452b95-43e9-412c-8bbc-80fcd92ca147",home:"Marion",homeScore:3,away:"Collierville",awayScore:1},
      {contestId:"01c9d8e3-fdea-4c12-879b-6a9f9726bb58",home:"Columbia Christian",homeScore:3,away:"Word of God Academy",awayScore:1},
      {contestId:"b3ba2de8-200c-412e-923e-7bad05699fd2",home:"Magnolia",homeScore:1,away:"Pleasant Grove",awayScore:3}
    ]);
    return {status:"SUCCESS",matchedFinals:3,observations:3,touchedTeams:3,recordResult:{standings:{cohorts:0}}};
  }});
  assert.equal(calls,1);
  assert.equal(result.preflight.targetTeams,3);
  assert.equal(result.sourceMode,"audited-snapshot");
  assert.equal(result.auditRunId,34172135818);
});

test("approved batch fails closed if opponent becomes local or target joins a conference",async()=>{
  await assert.rejects(runVolleyballConvergenceBatch({DB:fakeD1({opponentNowLocal:true})},{batchKey:VOLLEYBALL_CONVERGENCE_BATCH_KEY,runner:async()=>{throw new Error("writer reached");}}),/opponent is now local/);
  await assert.rejects(runVolleyballConvergenceBatch({DB:fakeD1({conferenceMembership:true})},{batchKey:VOLLEYBALL_CONVERGENCE_BATCH_KEY,runner:async()=>{throw new Error("writer reached");}}),/target now has conference membership/);
});
