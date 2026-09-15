import test from "node:test";
import assert from "node:assert/strict";
import { buildUnifiedTeamStatuses } from "../src/m4-public-worker.js";
import { loadStandingsTruth } from "../src/standings-truth.js";
import { recordFromScheduleRows, rowCountsForRecord } from "../src/schedule-response-normalizer.js";

function game({ id, sport="football", gender="boys", teamScore, opponentScore, conference=false, notes="", countsForRecord=1, parserType="maxpreps", day=1 }) {
  return {
    id,
    sport,
    gender,
    season:"2026",
    scheduled_at:`2026-09-${String(day).padStart(2,"0")}T00:00:00.000Z`,
    opponent:`Opponent ${id}`,
    status:"FINAL",
    team_score:teamScore,
    opponent_score:opponentScore,
    conference_game:conference ? 1 : 0,
    counts_for_record:countsForRecord,
    parser_type:parserType,
    notes
  };
}

function volleyballGames(prefix, wins, losses, conferenceWins=0, conferenceLosses=0) {
  const rows=[];
  let day=1;
  for(let i=0;i<wins;i++,day++) rows.push(game({ id:`${prefix}-w${i}`, sport:"volleyball", gender:"girls", teamScore:3, opponentScore:1, conference:i<conferenceWins, day }));
  for(let i=0;i<losses;i++,day++) rows.push(game({ id:`${prefix}-l${i}`, sport:"volleyball", gender:"girls", teamScore:1, opponentScore:3, conference:i<conferenceLosses, day }));
  return rows;
}

const cases = [
  {
    school:"Conway High School", schoolId:"conway", teamId:"conway-football-2026", sport:"football", gender:"boys",
    conferenceId:"7a-central", conference:"7A Central", publishedRank:1,
    games:[
      game({ id:"conway-capital", teamScore:45, opponentScore:7, countsForRecord:0, day:1 }),
      game({ id:"conway-bentonville", teamScore:14, opponentScore:20, day:2 }),
      game({ id:"conway-marion", teamScore:48, opponentScore:0, day:3 }),
      game({ id:"conway-meet-the-cats", teamScore:21, opponentScore:7, countsForRecord:0, notes:"Meet the Cats", day:4 })
    ],
    overall:"2-1", conferenceRecord:null, rank:null, visibleFinals:3, conferenceFinals:0
  },
  {
    school:"Conway High School", schoolId:"conway", teamId:"conway-volleyball-2026", sport:"volleyball", gender:"girls",
    conferenceId:"6a-central", conference:"6A Central", publishedRank:1,
    games:volleyballGames("conway-vb",10,6,3,0),
    overall:"10-6", conferenceRecord:"3-0", rank:1, visibleFinals:16, conferenceFinals:3
  },
  {
    school:"Gurdon High School", schoolId:"gurdon", teamId:"gurdon-football-2026", sport:"football", gender:"boys",
    conferenceId:"2a-region-3", conference:"2A Region 3", publishedRank:1,
    games:[game({ id:"gurdon-magnet-cove", teamScore:32, opponentScore:16, day:1 }),game({ id:"gurdon-hampton", teamScore:42, opponentScore:8, day:2 })],
    overall:"2-0", conferenceRecord:null, rank:null, visibleFinals:2, conferenceFinals:0
  },
  {
    school:"Batesville High School", schoolId:"batesville", teamId:"batesville-football-2026", sport:"football", gender:"boys",
    conferenceId:"5a-east", conference:"5A East", publishedRank:1,
    games:[game({ id:"batesville-searcy", teamScore:13, opponentScore:54, day:1 }),game({ id:"batesville-newport", teamScore:16, opponentScore:13, day:2 })],
    overall:"1-1", conferenceRecord:null, rank:null, visibleFinals:2, conferenceFinals:0
  },
  {
    school:"Parkers Chapel High School", schoolId:"parkers-chapel", teamId:"parkers-chapel-football-2026", sport:"football", gender:"boys",
    conferenceId:"3a-region-7", conference:"3A Region 7", publishedRank:1,
    games:[game({ id:"pc-hampton", teamScore:36, opponentScore:34, day:1 }),game({ id:"pc-genoa", teamScore:6, opponentScore:32, day:2 })],
    overall:"1-1", conferenceRecord:null, rank:null, visibleFinals:2, conferenceFinals:0
  },
  {
    school:"Bryant High School", schoolId:"bryant", teamId:"bryant-football-2026", sport:"football", gender:"boys",
    conferenceId:"7a-central", conference:"7A Central", publishedRank:1,
    games:[game({ id:"bryant-1", teamScore:35, opponentScore:14, day:1 }),game({ id:"bryant-2", teamScore:28, opponentScore:21, day:2 })],
    overall:"2-0", conferenceRecord:null, rank:null, visibleFinals:2, conferenceFinals:0
  },
  {
    school:"Greenbrier High School", schoolId:"greenbrier", teamId:"greenbrier-volleyball-2026", sport:"volleyball", gender:"girls",
    conferenceId:"5a-central", conference:"5A Central", publishedRank:2,
    games:volleyballGames("greenbrier-vb",6,2,2,1),
    overall:"6-2", conferenceRecord:"2-1", rank:2, visibleFinals:8, conferenceFinals:3
  },
  {
    school:"Vilonia High School", schoolId:"vilonia", teamId:"vilonia-volleyball-2026", sport:"volleyball", gender:"girls",
    conferenceId:"5a-central", conference:"5A Central", publishedRank:3,
    games:volleyballGames("vilonia-vb",4,1,1,1),
    overall:"4-1", conferenceRecord:"1-1", rank:3, visibleFinals:5, conferenceFinals:2
  }
];

function recordText(record) {
  return record.ties ? `${record.wins}-${record.losses}-${record.ties}` : `${record.wins}-${record.losses}`;
}

function conferenceRecordText(record) {
  const games=record.conference_wins+record.conference_losses+record.conference_ties;
  if(!games) return null;
  return record.conference_ties
    ? `${record.conference_wins}-${record.conference_losses}-${record.conference_ties}`
    : `${record.conference_wins}-${record.conference_losses}`;
}

const publishedByKey = new Map();
for(const sample of cases){
  const key=`${sample.sport}|${sample.conferenceId}`;
  if(!publishedByKey.has(key)) publishedByKey.set(key,[]);
  publishedByKey.get(key).push(sample);
}

function standingsHtml(rows){
  return `<table>${rows.map(row=>{
    const derived=recordFromScheduleRows(row.games,{reportingSchoolId:row.schoolId});
    const conf=conferenceRecordText(derived) || "0-0";
    return `<tr><td>${row.publishedRank}</td><td>${row.school}</td><td>${conf}</td><td>.000</td><td>${recordText(derived)}</td><td>.000</td></tr>`;
  }).join("")}</table>`;
}

function fakeFetchFactory(){
  return async input=>{
    const url=String(input?.url || input);
    if(url.includes("fearlessfriday.com/")) return { ok:false, status:404, url, async text(){return "";} };
    if(/^https:\/\/www\.maxpreps\.com\/ar\/(football|volleyball)\/$/.test(url)) return { ok:true, status:200, url, async text(){return "<html></html>";} };
    const match=url.match(/\/ar\/(football|volleyball)\/26-27\/conference\/([^/]+)\//);
    if(match){
      const rows=publishedByKey.get(`${match[1]}|${decodeURIComponent(match[2])}`) || [];
      return { ok:rows.length>0, status:rows.length?200:404, url, async text(){return standingsHtml(rows);} };
    }
    return { ok:false, status:404, url, async text(){return "";} };
  };
}

function emptyDb(){
  return {
    prepare(){
      return {
        bind(){ return this; },
        async first(){ return null; },
        async all(){ return { results:[], meta:{ rows_read:0, rows_written:0 } }; }
      };
    }
  };
}

test("M10 statewide truth matrix keeps local records authoritative and published tables as cross-check evidence", async () => {
  const originalFetch=globalThis.fetch;
  globalThis.fetch=fakeFetchFactory();
  try{
    const derivedByTeam=new Map();
    const seeds=cases.map(sample=>{
      const derived=recordFromScheduleRows(sample.games,{reportingSchoolId:sample.schoolId});
      derivedByTeam.set(sample.teamId,derived);
      assert.equal(derived.scored_finals,sample.visibleFinals,`${sample.school} visible scored finals`);
      assert.equal(derived.conference_wins+derived.conference_losses+derived.conference_ties,sample.conferenceFinals,`${sample.school} conference finals`);
      assert.equal(recordText(derived),sample.overall,`${sample.school} overall result eligibility`);
      assert.equal(conferenceRecordText(derived),sample.conferenceRecord,`${sample.school} conference result eligibility`);
      return {
        reporting_team_id:sample.teamId,
        school_id:sample.schoolId,
        school_name:sample.school,
        level:"high-school",
        sport:sample.sport,
        gender:sample.gender,
        season:"2026",
        conference_id:sample.conferenceId,
        conference_name:sample.conference,
        wins:derived.wins, losses:derived.losses, ties:derived.ties,
        conference_wins:derived.conference_wins,
        conference_losses:derived.conference_losses,
        conference_ties:derived.conference_ties,
        record_source:"schedule-derived"
      };
    });

    const env={ DB:emptyDb() };
    const statuses=await buildUnifiedTeamStatuses(env,seeds);
    assert.equal(statuses.length,cases.length);

    const truthByConference=new Map();
    for(const sample of cases){
      const key=`${sample.sport}|${sample.conferenceId}`;
      if(!truthByConference.has(key)) truthByConference.set(key,await loadStandingsTruth(env,{sport:sample.sport,conferenceId:sample.conferenceId,season:"2026"}));
    }

    const matrix=[];
    for(const sample of cases){
      const status=statuses.find(row=>row.team_id===sample.teamId);
      assert.ok(status,`${sample.school} team status missing`);
      const truth=truthByConference.get(`${sample.sport}|${sample.conferenceId}`);
      const standing=truth.standings.find(row=>row.school_name===sample.school);
      assert.ok(standing,`${sample.school} standings row missing`);
      const derived=derivedByTeam.get(sample.teamId);

      assert.equal(status.overall_record,sample.overall,`${sample.school} Team Detail overall`);
      assert.equal(status.conference_name,sample.conference,`${sample.school} conference membership`);
      assert.equal(status.conference_record,sample.conferenceRecord,`${sample.school} Team Detail conference record`);
      assert.equal(status.rank,null,`${sample.school} published rank must not become Team Detail truth without certified local standings`);
      assert.equal(status.overall_games,sample.visibleFinals,`${sample.school} Team Detail overall game count`);
      assert.equal(status.conference_games,sample.conferenceFinals,`${sample.school} Team Detail conference game count`);

      assert.equal(standing.overall_record,null,`${sample.school} published overall record must not become canonical standings truth`);
      assert.equal(standing.conference_record,null,`${sample.school} published conference record must not become canonical standings truth`);
      assert.equal(standing.rank,null,`${sample.school} published rank must not become canonical standings truth`);
      assert.equal(standing.published_overall_record,sample.overall,`${sample.school} published overall cross-check`);
      assert.equal(standing.published_conference_record,sample.conferenceRecord || "0-0",`${sample.school} published conference cross-check`);
      assert.equal(standing.published_rank,sample.publishedRank,`${sample.school} published rank cross-check`);
      assert.equal(standing.standing_state,"source-published",`${sample.school} published-only standing state`);
      assert.equal(standing.standings_verified,false,`${sample.school} published-only evidence must stay unverified`);

      if(sample.conferenceFinals===0){
        assert.equal(status.standing_state,"not-started",`${sample.school} Team Detail must not fabricate a standing`);
      }else{
        assert.equal(status.standing_state,"unavailable",`${sample.school} Team Detail rank waits for certified calculated standings`);
      }

      matrix.push({
        school:sample.school,
        sport:sample.sport,
        overall_record:status.overall_record,
        conference:status.conference_name,
        conference_record:status.conference_record ?? "N/A",
        rank:status.rank ?? "N/A",
        visible_scored_finals:derived.scored_finals,
        conference_finals:status.conference_games,
        status_source:status.source
      });
    }

    console.table(matrix);
  } finally {
    globalThis.fetch=originalFetch;
  }
});

test("ordinary legacy finals count while explicit non-record decisions remain excluded", () => {
  assert.equal(rowCountsForRecord(game({id:"legacy-ordinary-final",teamScore:21,opponentScore:14,countsForRecord:0,parserType:"maxpreps"})),true);
  assert.equal(rowCountsForRecord(game({id:"dragonfly-non-record",teamScore:21,opponentScore:14,countsForRecord:0,parserType:"dragonfly-public"})),false);
  assert.equal(rowCountsForRecord(game({id:"scrimmage",teamScore:21,opponentScore:14,countsForRecord:0,notes:"Scrimmage"})),false);
  assert.equal(rowCountsForRecord(game({id:"jamboree",teamScore:21,opponentScore:14,countsForRecord:0,notes:"Jamboree"})),false);
  assert.equal(rowCountsForRecord(game({id:"exhibition",teamScore:21,opponentScore:14,countsForRecord:0,notes:"Exhibition"})),false);
  assert.equal(rowCountsForRecord(game({id:"benefit",teamScore:21,opponentScore:14,countsForRecord:0,notes:"Benefit game"})),false);
  assert.equal(rowCountsForRecord(game({id:"meet-cats",teamScore:21,opponentScore:14,countsForRecord:0,notes:"Meet the Cats"})),false);
  assert.equal(rowCountsForRecord({
    ...game({id:"preseason-basketball",sport:"basketball",gender:"girls",teamScore:50,opponentScore:40,countsForRecord:1}),
    scheduled_at:"2026-11-01T20:00:00.000Z"
  }),false);
});
