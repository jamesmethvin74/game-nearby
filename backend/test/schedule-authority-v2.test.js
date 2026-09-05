import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import {
  normalizeSchoolAlias, canonicalCandidateKey, observationsLikelySameEvent,
  detectEventConflicts, resolveCanonicalEvent, deriveSourceHealth, collectionSafety
} from "../src/schedule-authority-core.js";
import { normalizeDragonFlyPayload, normalizeDragonFlyPublicText } from "../src/dragonfly-core.js";
import { dragonFlyFeedBaseUrl, dragonFlyPageUrl, fetchDragonFlyPagedPayload } from "../src/dragonfly-feed.js";

const fixtureDir=fileURLToPath(new URL("./fixtures/",import.meta.url));
const base={sport:"volleyball",gender:"girls",season:"2026",timezone:"America/Chicago"};
const gb={...base,id:"greenbrier-school:vilonia",source_id:"greenbrier-volleyball-official",source_type:"official-school",parser_type:"mascot-media",reporting_school_id:"greenbrier",opponent_school_id:"vilonia",opponent:"Vilonia",scheduled_at:"2026-08-25T21:30:00.000Z",scheduled_time_known:1,home_away:"away",venue:"Vilonia High School",status:"FINAL",team_score:3,opponent_score:0};
const vil={...base,id:"vilonia-school:greenbrier",source_id:"vilonia-volleyball-official",source_type:"official-school",parser_type:"mascot-media",reporting_school_id:"vilonia",opponent_school_id:"greenbrier",opponent:"Greenbrier",scheduled_at:"2026-08-25T22:30:00.000Z",scheduled_time_known:1,home_away:"home",venue:"Vilonia High School",status:"SCHEDULED",team_score:null,opponent_score:null};

test("normalizes school identity generically and matches mascot forms through school metadata",()=>{
  assert.equal(normalizeSchoolAlias("Conway High School"),"conway");
  assert.equal(normalizeSchoolAlias("Conway Wampus Cats"),"conway wampus cats");
  assert.equal(normalizeSchoolAlias("Greenbrier Panthers"),"greenbrier panthers");
  assert.equal(normalizeSchoolAlias("Vilonia High School"),"vilonia");

  const identityMatches=(observed,school)=>{
    const normalized=normalizeSchoolAlias(observed);
    return normalized===normalizeSchoolAlias(school.name)
      || normalized===normalizeSchoolAlias(`${school.name} ${school.mascot||""}`);
  };
  assert.equal(identityMatches("Conway Wampus Cats",{name:"Conway High School",mascot:"Wampus Cats"}),true);
  assert.equal(identityMatches("Russellville Cyclones",{name:"Russellville High School",mascot:"Cyclones"}),true);
  assert.equal(identityMatches("Russellville Panthers",{name:"Russellville High School",mascot:"Cyclones"}),false);
});

test("reconciles Greenbrier at Vilonia and Vilonia vs Greenbrier as one canonical event",()=>{
  assert.equal(observationsLikelySameEvent(gb,vil),true);
  const event=resolveCanonicalEvent([gb,vil]);
  assert.equal(event.participantA,"greenbrier");
  assert.equal(event.participantB,"vilonia");
  assert.equal(event.homeSchoolId,"vilonia");
  assert.equal(event.awaySchoolId,"greenbrier");
  assert.equal(event.id,"ce:volleyball:girls:2026:greenbrier:vilonia:20260825:t1630");
});

test("reciprocal perspectives do not create false home-away or lifecycle status conflicts",()=>{
  const conflicts=detectEventConflicts([gb,vil]);
  assert.equal(conflicts.some(c=>c.type==="HOME_AWAY"),false);
  assert.equal(conflicts.some(c=>c.type==="TIME"),true);
  assert.equal(conflicts.some(c=>c.type==="STATUS"),false);
});

test("detects a real reversed-home conflict",()=>{
  const bad={...vil,id:"bad",home_away:"away"};
  assert.equal(detectEventConflicts([gb,bad]).some(c=>c.type==="HOME_AWAY"),true);
});

test("detects date conflicts for strong reciprocal matches within the reconciliation window",()=>{
  const shifted={...vil,id:"shifted",scheduled_at:"2026-08-26T22:30:00.000Z"};
  assert.equal(observationsLikelySameEvent(gb,shifted),true);
  assert.equal(detectEventConflicts([gb,shifted]).some(c=>c.type==="DATE"),true);
});

test("does not match solely on opponent text or across sports",()=>{
  assert.equal(observationsLikelySameEvent(gb,{...vil,opponent_school_id:null}),false);
  assert.equal(observationsLikelySameEvent(gb,{...vil,sport:"football"}),false);
  assert.notEqual(canonicalCandidateKey(gb),canonicalCandidateKey({...gb,sport:"football"}));
});

test("keeps same-day repeat matchups separate while tolerating ordinary source time disagreement",()=>{
  const early={...gb,id:"early",source_event_key:"native:school-early",scheduled_at:"2026-08-25T15:00:00.000Z",status:"SCHEDULED",team_score:null,opponent_score:null};
  const late={...early,id:"late",source_event_key:"native:school-late",scheduled_at:"2026-08-25T20:00:00.000Z"};
  const reciprocalEarly={...vil,id:"reciprocal-early",source_event_key:"native:vilonia-early",scheduled_at:"2026-08-25T15:30:00.000Z"};
  assert.equal(observationsLikelySameEvent(early,late),false);
  assert.equal(observationsLikelySameEvent(early,reciprocalEarly),true);
  const earlyEvent=resolveCanonicalEvent([early,reciprocalEarly]);
  const lateEvent=resolveCanonicalEvent([late]);
  assert.notEqual(earlyEvent.id,lateEvent.id);
  assert.match(earlyEvent.id,/t1000$/);
  assert.match(lateEvent.id,/t1500$/);
});

test("DragonFly authority wins deterministic field selection while conflicts remain visible",()=>{
  const official={...gb,id:"official",authority_rank:20};
  const dragonfly={...vil,id:"dragonfly",source_id:"dragonfly",parser_type:"dragonfly-public",authority_rank:10,venue:"Different Gym",scheduled_at:"2026-08-25T22:00:00.000Z",scheduled_time_known:1,status:"SCHEDULED"};
  const event=resolveCanonicalEvent([official,dragonfly]);
  assert.equal(event.selectedSourceId,"dragonfly");
  assert.equal(event.scheduledAt,dragonfly.scheduled_at);
  assert.equal(event.venue,"Different Gym");
  assert.equal(event.status,"FINAL");
  assert.equal(event.homeScore,0);
  assert.equal(event.awayScore,3);
  assert.equal(event.trustState,"CONFLICT");
  assert.equal(event.conflicts.some(c=>c.type==="TIME"),true);
  assert.equal(event.conflicts.some(c=>c.type==="VENUE"),true);
});

test("parses a structured public DragonFly event without authentication data",()=>{
  const source={season:"2026",timezone:"America/Chicago",home_venue:"",home_latitude:null,home_longitude:null};
  const event={
    startTime:"2026-08-25T21:30:00Z",name:"Volleyball",
    participants:[
      {id:"a",name:"Greenbrier Panthers",homeAway:"away"},
      {id:"b",name:"Vilonia Eagles",homeAway:"home"}
    ]
  };
  const parsed=normalizeDragonFlyPayload([event],source);
  assert.equal(parsed.length,2);
  assert.equal(parsed[0].opponent,"Vilonia Eagles");
  assert.equal(parsed[0].homeAway,"away");
  assert.equal(parsed[0].scheduledTimeKnown,true);
});

test("parses the captured real Greenbrier-Vilonia DragonFly event from both perspectives",()=>{
  const fixture=JSON.parse(fs.readFileSync(`${fixtureDir}/dragonfly-greenbrier-vilonia.json`,"utf8"));
  const source={season:"2026",timezone:"America/Chicago",home_venue:"",home_latitude:null,home_longitude:null};
  const parsed=normalizeDragonFlyPayload(fixture,source);
  assert.ok(parsed.length>=2);
  const greenbrier=parsed.find(row=>/greenbrier/i.test(row.reportingSchool||row.team||""));
  const vilonia=parsed.find(row=>/vilonia/i.test(row.reportingSchool||row.team||""));
  assert.ok(greenbrier);
  assert.ok(vilonia);
  assert.equal(greenbrier.opponentSchoolExternalId,vilonia.reportingSchoolExternalId);
  assert.equal(vilonia.opponentSchoolExternalId,greenbrier.reportingSchoolExternalId);
});

test("walks every DragonFly page and deduplicates overlapping event ids",async()=>{
  const pages={
    [dragonFlyFeedBaseUrl("VB_Varsity",0)]:{content:[{id:"1"},{id:"2"}],totalPages:2},
    [dragonFlyPageUrl(dragonFlyFeedBaseUrl("VB_Varsity",0),1)]:{content:[{id:"2"},{id:"3"}],totalPages:2}
  };
  const calls=[];
  const fetchFn=async url=>{
    calls.push(url);
    return new Response(JSON.stringify(pages[url]),{status:200,headers:{"content-type":"application/json"}});
  };
  const result=await fetchDragonFlyPagedPayload(dragonFlyFeedBaseUrl("VB_Varsity",0),{fetchFn});
  assert.equal(result.content.length,3);
  assert.equal(calls.length,2);
});

test("parses the captured current public DragonFly schedule-card text format",()=>{
  const text=fs.readFileSync(`${fixtureDir}/dragonfly-public-text.txt`,"utf8");
  const source={season:"2026",timezone:"America/Chicago",home_venue:"",home_latitude:null,home_longitude:null};
  const parsed=normalizeDragonFlyPublicText(text,source);
  assert.ok(parsed.length>0);
});

test("collection safety rejects suspicious shrinkage so last-known-good data is retained",()=>{
  const unsafe=collectionSafety({parsedCount:3,expectedMinGames:6,priorCount:12});
  assert.equal(unsafe.safe,false);
  const suspicious=collectionSafety({parsedCount:7,expectedMinGames:6,priorCount:12});
  assert.equal(suspicious.safe,false);
  const safe=collectionSafety({parsedCount:10,expectedMinGames:6,priorCount:12});
  assert.equal(safe.safe,true);
});

test("derives source health states from freshness, failures and conflicts",()=>{
  const now=new Date("2026-08-26T12:00:00Z");
  assert.equal(deriveSourceHealth({}),"NEVER_FETCHED");
  assert.equal(deriveSourceHealth({last_successful_fetch_at:"2026-08-26T10:00:00Z",refresh_minutes:60,stale_after_minutes:180}, {now}),"HEALTHY");
  assert.equal(deriveSourceHealth({last_successful_fetch_at:"2026-08-25T10:00:00Z",refresh_minutes:60,stale_after_minutes:180}, {now}),"STALE");
  assert.equal(deriveSourceHealth({last_successful_fetch_at:"2026-08-26T10:00:00Z",consecutive_failures:3,stale_after_minutes:180}, {now}),"FAILING");
});

test("classification remains sport-specific in schema and V1 correction migration",()=>{
  const migration=fs.readFileSync(fileURLToPath(new URL("../migrations/0003_fix_volleyball_conferences_and_sources.sql",import.meta.url)),"utf8");
  assert.match(migration,/volleyball/i);
  assert.doesNotMatch(migration,/UPDATE\s+teams\s+SET\s+conference_id\s*=\s*NULL\s*;?/i);
});
