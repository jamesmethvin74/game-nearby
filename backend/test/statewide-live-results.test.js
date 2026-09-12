import test from "node:test";
import assert from "node:assert/strict";
import { certifiedStatewideSignature } from "../src/dragonfly-certified-statewide.js";
import { runStatewideLiveResultProbe, statewideResultSnapshotChanged } from "../src/statewide-live-results.js";
import { statewideSportConfig } from "../src/statewide-sport-config.js";

function basketballPayload({code="MBB",name="Boys' Basketball"}={}) {
  return {
    schedule:[{
      eventId:"basketball-event-1",
      date:"2026-11-10T01:00:00.000Z",
      associatedSports:[{code,name,level:"Varsity"}],
      participants:[
        {
          name:"Conway High School",
          orgShortCode:"HNHRP8",
          isHome:true,
          team:{teamId:"team-conway-boys"},
          result:{code:"W",score:67,opponentScore:58}
        },
        {
          name:"Little Rock Central High School",
          orgShortCode:"CENTRAL",
          isHome:false,
          team:{teamId:"team-central-boys"},
          result:{code:"L",score:58,opponentScore:67}
        }
      ]
    }],
    hasNextPage:false
  };
}

test("basketball semantic snapshot uses the certified sport-aware signature",()=>{
  const config=statewideSportConfig("basketball-boys");
  const payload=basketballPayload();
  const signature=certifiedStatewideSignature(payload,config);
  const unchanged=statewideResultSnapshotChanged(JSON.stringify({signature}),payload,config);
  assert.equal(unchanged.changed,false);
  assert.equal(unchanged.signature,signature);

  const changed=statewideResultSnapshotChanged(JSON.stringify({signature:"old"}),payload,config);
  assert.equal(changed.changed,true);
  assert.equal(changed.signature,signature);
});

test("unchanged basketball live probe performs one state read and zero D1 writes",async()=>{
  const config=statewideSportConfig("basketball-boys");
  const payload=basketballPayload();
  const signature=certifiedStatewideSignature(payload,config);
  let prepareCalls=0;
  let firstCalls=0;
  let runCalls=0;
  let allCalls=0;

  const env={
    DB:{
      prepare(sql){
        prepareCalls++;
        assert.match(sql,/SELECT details_json FROM statewide_collection_state WHERE id=\?/);
        return {
          bind(id){
            assert.equal(id,config.stateId);
            return {
              async first(){
                firstCalls++;
                return {details_json:JSON.stringify({signature})};
              },
              async run(){runCalls++; throw new Error("unchanged live probe must not write");},
              async all(){allCalls++; throw new Error("unchanged live probe must not issue extra reads");}
            };
          }
        };
      }
    }
  };

  let fetchCalls=0;
  const fetchFn=async url=>{
    fetchCalls++;
    assert.equal(url,`${config.feedUrl}/0`);
    return {ok:true,status:200,json:async()=>payload};
  };

  const result=await runStatewideLiveResultProbe(env,config,{
    fetchFn,
    now:new Date("2026-11-10T03:30:00.000Z")
  });

  assert.equal(result.status,"NOT_MODIFIED");
  assert.equal(result.sportKey,"basketball-boys");
  assert.equal(result.rawEventCount,1);
  assert.equal(result.pagesFetched,1);
  assert.equal(result.touchedTeams,0);
  assert.equal(result.d1Writes,0);
  assert.equal(prepareCalls,1);
  assert.equal(firstCalls,1);
  assert.equal(runCalls,0);
  assert.equal(allCalls,0);
  assert.equal(fetchCalls,1);
});

test("boys and girls basketball use distinct certified result signatures",()=>{
  const boys=statewideSportConfig("basketball-boys");
  const girls=statewideSportConfig("basketball-girls");
  const boysPayload=basketballPayload();
  const girlsPayload=basketballPayload({code:"WBB",name:"Girls' Basketball"});
  const boysSignature=certifiedStatewideSignature(boysPayload,boys);
  const girlsSignature=certifiedStatewideSignature(girlsPayload,girls);
  assert.notEqual(boysSignature,girlsSignature);
});
