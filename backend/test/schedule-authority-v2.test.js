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

test("reciprocal perspectives do not create a false home-away conflict",()=>{
  const conflicts=detectEventConflicts([gb,vil]);
  assert.equal(conflicts.some(c=>c.type==="HOME_AWAY"),false);
  assert.equal(conflicts.some(c=>c.type==="TIME"),true);
  assert.equal(conflicts.some(c=>c.type==="STATUS"),true);
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
  const dragonfly={...gb,id:"dragonfly",source_id:"greenbrier-volleyball-dragonfly",source_type:"official-conference",parser_type:"dragonfly-public",authority_rank:10,scheduled_at:"2026-08-25T22:00:00.000Z",status:"SCHEDULED",team_score:null,opponent_score:null};
  const event=resolveCanonicalEvent([gb,vil,dragonfly]);
  assert.equal(event.selectedSourceId,"greenbrier-volleyball-dragonfly");
  assert.equal(event.scheduledAt,"2026-08-25T22:00:00.000Z");
  assert.equal(event.trustState,"CONFLICT");
  assert.ok(event.conflicts.some(c=>c.type==="TIME"));
});

test("parses a structured public DragonFly event without authentication data",()=>{
  const payload={data:{events:[{
    id:"public-game-1",startDateTime:"2026-08-25T22:00:00Z",status:"Scheduled",
    sport:{name:"Volleyball"},level:{name:"Varsity"},
    homeTeam:{name:"Vilonia High School"},awayTeam:{name:"Greenbrier High School"},
    venue:{name:"Vilonia High School"}
  }]}};
  const source={...base,school_name:"Greenbrier High School",home_latitude:35.2334,home_longitude:-92.3870};
  const [game]=normalizeDragonFlyPayload(payload,source);
  assert.equal(game.opponent,"Vilonia High School");
  assert.equal(game.homeAway,"away");
  assert.equal(game.scheduledAt,"2026-08-25T22:00:00.000Z");
  assert.match(game.sourceEventKey,/native:public-game-1/);
});

test("parses the captured real Greenbrier-Vilonia DragonFly event from both perspectives",()=>{
  const payload=JSON.parse(fs.readFileSync(`${fixtureDir}/dragonfly-greenbrier-vilonia-2026.json`,"utf8"));
  const greenbrierSource={...base,school_name:"Greenbrier High School",home_latitude:35.2334,home_longitude:-92.3870};
  const viloniaSource={...base,school_name:"Vilonia High School",home_latitude:35.0839,home_longitude:-92.2029};
  const [greenbrier]=normalizeDragonFlyPayload(payload,greenbrierSource);
  const [vilonia]=normalizeDragonFlyPayload(payload,viloniaSource);
  assert.equal(greenbrier.sourceEventKey,"native:69cbc6e2a49cc05727000000");
  assert.equal(vilonia.sourceEventKey,greenbrier.sourceEventKey);
  assert.equal(greenbrier.scheduledAt,"2026-08-25T22:30:00.000Z");
  assert.equal(greenbrier.opponent,"VILONIA HIGH SCHOOL");
  assert.equal(greenbrier.homeAway,"away");
  assert.equal(greenbrier.status,"FINAL");
  assert.equal(greenbrier.result,"W");
  assert.equal(greenbrier.teamScore,3);
  assert.equal(vilonia.opponent,"GREENBRIER HIGH SCHOOL");
  assert.equal(vilonia.homeAway,"home");
  assert.equal(vilonia.status,"FINAL");
  assert.equal(vilonia.result,"L");
  assert.equal(vilonia.teamScore,0);

  const toObservation=(game,reportingSchoolId,opponentSchoolId,sourceId)=>({
    ...base,id:`${sourceId}:${game.sourceEventKey}`,source_id:sourceId,source_type:"official-conference",parser_type:"dragonfly-public",authority_rank:10,
    reporting_school_id:reportingSchoolId,opponent_school_id:opponentSchoolId,source_event_key:game.sourceEventKey,
    scheduled_at:game.scheduledAt,scheduled_time_known:game.scheduledTimeKnown?1:0,home_away:game.homeAway,venue:game.venue,status:game.status,
    team_score:game.teamScore,opponent_score:game.opponentScore
  });
  const canonical=resolveCanonicalEvent([
    toObservation(greenbrier,"greenbrier","vilonia","greenbrier-volleyball-dragonfly"),
    toObservation(vilonia,"vilonia","greenbrier","vilonia-volleyball-dragonfly")
  ]);
  assert.equal(canonical.id,"ce:volleyball:girls:2026:greenbrier:vilonia:20260825:df-69cbc6e2a49cc05727000000");
  assert.equal(canonical.trustState,"CORROBORATED");
  assert.equal(canonical.homeSchoolId,"vilonia");
  assert.equal(canonical.awaySchoolId,"greenbrier");
});

test("walks every DragonFly page and deduplicates overlapping event ids",async()=>{
  const calls=[];
  const pages=[
    {timestamp:"2026-08-31T17:00:00Z",hasNextPage:true,schedule:[{eventId:"a"}]},
    {timestamp:"2026-08-31T17:01:00Z",hasNextPage:false,schedule:[{eventId:"a"},{eventId:"b"}]}
  ];
  const fetchFn=async url=>{
    calls.push(url);
    const payload=pages[calls.length-1];
    return {ok:true,status:200,json:async()=>payload};
  };
  const sourceUrl="https://maxinfosite-api-live.dragonflyathletics.com/states/ArkAA/schedules/2026/WVB_Varsity/0";
  const result=await fetchDragonFlyPagedPayload(sourceUrl,{fetchFn});
  assert.equal(dragonFlyFeedBaseUrl(sourceUrl),"https://maxinfosite-api-live.dragonflyathletics.com/states/ArkAA/schedules/2026/WVB_Varsity");
  assert.equal(dragonFlyPageUrl(sourceUrl,1),"https://maxinfosite-api-live.dragonflyathletics.com/states/ArkAA/schedules/2026/WVB_Varsity/1");
  assert.deepEqual(calls,[
    "https://maxinfosite-api-live.dragonflyathletics.com/states/ArkAA/schedules/2026/WVB_Varsity/0",
    "https://maxinfosite-api-live.dragonflyathletics.com/states/ArkAA/schedules/2026/WVB_Varsity/1"
  ]);
  assert.equal(result.pageCount,2);
  assert.deepEqual(result.payload.schedule.map(event=>event.eventId),["a","b"]);
  assert.equal(result.payload.timestamp,"2026-08-31T17:01:00Z");
});

test("parses the captured current public DragonFly schedule-card text format",()=>{
  const text=fs.readFileSync(`${fixtureDir}/dragonfly-bauxite-public.txt`,"utf8");
  const source={sport:"basketball",gender:"boys",season:"2026",timezone:"America/Chicago",school_name:"Bauxite High School",home_venue:"Bauxite High School",home_latitude:34.55,home_longitude:-92.52};
  const games=normalizeDragonFlyPublicText(text,source);
  assert.equal(games.length,2);
  assert.equal(games[0].opponent,"Smackover");
  assert.equal(games[0].homeAway,"home");
  assert.equal(games[1].opponent,"Mountain Pine");
  assert.equal(games[1].homeAway,"away");
});

test("collection safety rejects suspicious shrinkage so last-known-good data is retained",()=>{
  const tooFew=collectionSafety({parsedCount:3,expectedMinGames:5,priorCount:20});
  assert.equal(tooFew.safe,false);
  assert.match(tooFew.reason,/Last known good data retained/);
  const suspiciousDrop=collectionSafety({parsedCount:14,expectedMinGames:5,priorCount:20});
  assert.equal(suspiciousDrop.safe,false);
  assert.match(suspiciousDrop.reason,/refusing destructive reconciliation/);
  const healthy=collectionSafety({parsedCount:18,expectedMinGames:5,priorCount:20});
  assert.equal(healthy.safe,true);
});

test("derives source health states from freshness, failures and conflicts",()=>{
  const now=new Date("2026-08-31T17:00:00Z");
  assert.equal(deriveSourceHealth({refresh_minutes:180},{now}),"NEVER_FETCHED");
  assert.equal(deriveSourceHealth({last_checked_at:"2026-08-31T16:00:00Z",last_successful_fetch_at:"2026-08-31T16:00:00Z",refresh_minutes:180},{now}),"HEALTHY");
  assert.equal(deriveSourceHealth({last_checked_at:"2026-08-31T16:00:00Z",last_successful_fetch_at:"2026-08-30T00:00:00Z",refresh_minutes:180},{now}),"STALE");
  assert.equal(deriveSourceHealth({last_checked_at:"2026-08-31T16:00:00Z",last_successful_fetch_at:"2026-08-31T16:00:00Z",consecutive_failures:3,refresh_minutes:180},{now}),"FAILING");
  assert.equal(deriveSourceHealth({last_checked_at:"2026-08-31T16:00:00Z",last_successful_fetch_at:"2026-08-31T16:00:00Z",active_conflict_count:1,refresh_minutes:180},{now}),"CONFLICT");
});

test("classification remains sport-specific in schema and V1 correction migration",()=>{
  const initial=fs.readFileSync(fileURLToPath(new URL("../migrations/0001_initial.sql",import.meta.url)),"utf8");
  const correction=fs.readFileSync(fileURLToPath(new URL("../migrations/0003_fix_volleyball_conferences_and_sources.sql",import.meta.url)),"utf8");
  const schoolsBlock=initial.match(/CREATE TABLE IF NOT EXISTS schools \([\s\S]*?\);/)?.[0]||"";
  const teamsBlock=initial.match(/CREATE TABLE IF NOT EXISTS teams \([\s\S]*?\);/)?.[0]||"";
  assert.doesNotMatch(schoolsBlock,/conference_id/);
  assert.match(teamsBlock,/conference_id/);
  assert.match(correction,/WHERE id='conway-volleyball-2026'/);
  assert.match(correction,/conference_id='6a-central-volleyball'/);
});
