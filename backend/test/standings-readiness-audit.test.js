import test from "node:test";
import assert from "node:assert/strict";
import {
  buildStatewideStandingsReadinessAudit,
  inspectStandingsPresentation
} from "../src/standings-readiness-audit.js";

function conference(id="7a-west"){return {id,name:id.toUpperCase()};}

test("published presentation fallback is READY, not blocking",()=>{
  const payload={
    conference:{
      id:"7a-west",durable_conference_id:"7a-west-football",
      presentation_method:"published",presentation_complete:true,
      membership_complete:false,result_evidence_complete:false,
      membership_truth:{expected_members:8,explicit_members:7}
    },
    standings:[{
      school_name:"Alpha",rank:null,conference_record:null,overall_record:null,
      published_rank:2,published_conference_record:"0-0",published_overall_record:"3-0",
      display_rank:2,display_conference_record:"0-0",display_overall_record:"3-0",
      display_method:"published"
    }]
  };
  const issues=inspectStandingsPresentation(payload,{sport:"football",conference:conference()});
  assert.equal(issues.some(row=>row.severity==="blocking"),false);
  assert.equal(issues.some(row=>row.code==="STANDINGS_USING_PUBLISHED_FALLBACK"),true);
});

test("published evidence hidden behind null presentation is blocking",()=>{
  const payload={
    conference:{
      id:"7a-west",durable_conference_id:"7a-west-football",
      presentation_method:"canonical-unverified",presentation_complete:false
    },
    standings:[{
      school_name:"Alpha",
      published_rank:1,published_conference_record:"0-0",published_overall_record:"3-0",
      display_rank:null,display_conference_record:null,display_overall_record:null
    }]
  };
  const issues=inspectStandingsPresentation(payload,{sport:"football",conference:conference()});
  assert.equal(issues.some(row=>row.code==="STANDINGS_PUBLISHED_VALUE_HIDDEN"&&row.severity==="blocking"),true);
  assert.equal(issues.some(row=>row.code==="STANDINGS_PRESENTATION_INCOMPLETE"&&row.severity==="blocking"),true);
});

test("football conference namespace mismatch is blocking",()=>{
  const payload={
    conference:{
      id:"7a-west",durable_conference_id:"wrong-football",
      presentation_method:"published",presentation_complete:true
    },
    standings:[{
      school_name:"Alpha",
      published_conference_record:"0-0",published_overall_record:"3-0",
      display_conference_record:"0-0",display_overall_record:"3-0",display_method:"published"
    }]
  };
  const issues=inspectStandingsPresentation(payload,{sport:"football",conference:conference()});
  assert.equal(issues.some(row=>row.code==="STANDINGS_CONFERENCE_ID_CONTRACT"&&row.severity==="blocking"),true);
});

test("statewide readiness audits every published conference and blocks one bad surface",async()=>{
  const listOptions=async({sport})=>({
    conferences:sport==="football"
      ? [{id:"7a-central",name:"7A Central"},{id:"7a-west",name:"7A West"}]
      : [{id:"6a-central",name:"6A Central"}]
  });
  const loadTruth=async(_env,{sport,conferenceId})=>{
    if(conferenceId==="7a-west") {
      return {
        conference:{id:"7a-west",durable_conference_id:"7a-west-football",presentation_complete:false},
        standings:[{school_name:"Broken",published_conference_record:"0-0",published_overall_record:"2-0",display_conference_record:null,display_overall_record:null}]
      };
    }
    return {
      conference:{
        id:conferenceId,
        durable_conference_id:sport==="football"?conferenceId+"-football":conferenceId,
        presentation_method:"canonical",presentation_complete:true,
        membership_complete:true,result_evidence_complete:true
      },
      standings:[{school_name:"Good",display_conference_record:"0-0",display_overall_record:"2-0",display_method:"canonical"}]
    };
  };
  const result=await buildStatewideStandingsReadinessAudit({},{
    sports:["football","volleyball"],listOptions,loadTruth
  });
  assert.equal(result.summary.conferences_examined,3);
  assert.equal(result.status,"BLOCKED");
  assert.ok(result.summary.blocking_issues>=1);
  assert.equal(result.issues.some(row=>row.conference_id==="7a-west"&&row.severity==="blocking"),true);
});
