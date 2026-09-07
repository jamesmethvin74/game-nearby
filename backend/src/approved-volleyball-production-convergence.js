import { syncPublishedVolleyballConferenceMembership } from "./volleyball-conference-membership.js";
import { runMaxPrepsVolleyballResultFallback } from "./maxpreps-volleyball-result-collector.js";
import { rebuildTeamRecords } from "./record-rebuild.js";

const STATE_ID="approved-repair:volleyball-production-proof:2026-09-07";
const CONWAY_TEAM="conway-volleyball-2026";
const SOUTHWEST_TEAM="df-bkc4ux-volleyball-2026";
const FLIPPIN_TEAM="df-qyu4f7-volleyball-2026";
const MELBOURNE_TEAM="df-x7qmns-volleyball-2026";
const CONWAY_SOURCE="conway-volleyball-official";
const SIX_A_CENTRAL_SOURCE_URL="https://www.maxpreps.com/ar/volleyball/26-27/conference/6a-central/?leagueid=01ee6b6b-f05d-4a62-80a5-a170c72cb088";
const THREE_A_TWO_SOURCE_URL="https://www.maxpreps.com/ar/volleyball/26-27/conference/3a-2/?leagueid=04adba69-8b0f-458a-a369-16bf0ac9c6fb";
const THREE_A_TWO_TEAMS=[
  "df-qyu4f7-volleyball-2026",
  "df-x7qmns-volleyball-2026",
  "df-bjp5e4-volleyball-2026",
  "df-wgx266-volleyball-2026",
  "df-xyeqvx-volleyball-2026",
  "df-t5drr3-volleyball-2026",
  "df-aybgpr-volleyball-2026"
];
const TARGET_TEAMS=[CONWAY_TEAM,SOUTHWEST_TEAM,...THREE_A_TWO_TEAMS];
const HISTORICAL_DATES=["2026-08-27","2026-08-29"];

async function completionRow(env) {
  return env.DB.prepare(
    "SELECT last_successful_fetch_at,details_json FROM statewide_collection_state WHERE id=?"
  ).bind(STATE_ID).first();
}

async function proofRows(env) {
  const result=await env.DB.prepare(`
    SELECT
      'record' AS kind,
      t.id AS key,
      t.conference_id,
      r.wins,r.losses,r.ties,
      r.conference_wins,r.conference_losses,r.conference_ties,
      NULL AS opponent,NULL AS team_score,NULL AS opponent_score,NULL AS result
    FROM teams t
    LEFT JOIN team_records r ON r.team_id=t.id
    WHERE t.id IN (SELECT value FROM json_each(?))

    UNION ALL

    SELECT
      'game' AS kind,
      g.team_id AS key,
      NULL AS conference_id,
      NULL AS wins,NULL AS losses,NULL AS ties,
      NULL AS conference_wins,NULL AS conference_losses,NULL AS conference_ties,
      g.opponent,g.team_score,g.opponent_score,g.result
    FROM games g
    WHERE g.status='FINAL'
      AND (
        (g.team_id=? AND lower(g.opponent) LIKE 'little rock christian%')
        OR (g.team_id=? AND (lower(g.opponent) LIKE 'bergman%' OR lower(g.opponent) LIKE 'cotter%'))
      )
  `).bind(JSON.stringify(TARGET_TEAMS),CONWAY_TEAM,FLIPPIN_TEAM).all();
  return result.results||[];
}

export function validateVolleyballConvergenceProof(rows=[]) {
  const record=teamId=>rows.find(row=>row.kind==="record"&&row.key===teamId)||{};
  const games=teamId=>rows.filter(row=>row.kind==="game"&&row.key===teamId);
  const conway=record(CONWAY_TEAM),southwest=record(SOUTHWEST_TEAM),flippin=record(FLIPPIN_TEAM),melbourne=record(MELBOURNE_TEAM);
  const hasGame=(teamId,opponentPattern,teamScore,opponentScore,result)=>games(teamId).some(row=>
    opponentPattern.test(String(row.opponent||""))
      && Number(row.team_score)===teamScore
      && Number(row.opponent_score)===opponentScore
      && row.result===result
  );

  const checks={
    conwayOverall:Number(conway.wins)===5&&Number(conway.losses)===4&&Number(conway.ties||0)===0,
    conwayConference:conway.conference_id==="6a-central-volleyball"&&Number(conway.conference_wins)===1&&Number(conway.conference_losses||0)===0,
    southwestOverall:Number(southwest.wins)===1&&Number(southwest.losses)===3&&Number(southwest.ties||0)===0,
    southwestConference:southwest.conference_id==="6a-central-volleyball"&&Number(southwest.conference_wins||0)===0&&Number(southwest.conference_losses)===1,
    flippinOverall:Number(flippin.wins)===4&&Number(flippin.losses)===2&&Number(flippin.ties||0)===0,
    flippinConference:flippin.conference_id==="3a-2-volleyball"&&Number(flippin.conference_wins)===3&&Number(flippin.conference_losses||0)===0,
    melbourneOverall:Number(melbourne.wins)===3&&Number(melbourne.losses)===1&&Number(melbourne.ties||0)===0,
    melbourneConference:melbourne.conference_id==="3a-2-volleyball"&&Number(melbourne.conference_wins)===2&&Number(melbourne.conference_losses)===1,
    conwayLrChristian:hasGame(CONWAY_TEAM,/^little rock christian/i,2,1,"W"),
    flippinBergman:hasGame(FLIPPIN_TEAM,/^bergman/i,3,2,"W"),
    flippinCotter:hasGame(FLIPPIN_TEAM,/^cotter/i,0,2,"L")
  };
  return {complete:Object.values(checks).every(Boolean),checks,rows};
}

async function markComplete(env,checkedAt,details) {
  await env.DB.prepare(`
    INSERT INTO statewide_collection_state(
      id,provider,feed_url,last_checked_at,last_successful_fetch_at,
      last_event_count,last_observation_count,last_source_count,consecutive_failures,last_error,details_json,updated_at
    ) VALUES(?, 'localbleachers-approved-repair', 'internal:volleyball-production-proof', ?, ?, 0, 0, 0, 0, NULL, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      last_checked_at=excluded.last_checked_at,
      last_successful_fetch_at=excluded.last_successful_fetch_at,
      consecutive_failures=0,last_error=NULL,details_json=excluded.details_json,updated_at=excluded.updated_at
  `).bind(STATE_ID,checkedAt,checkedAt,JSON.stringify(details),checkedAt).run();
}

export async function runApprovedVolleyballProductionConvergence(env,{
  now=new Date(),
  refreshSourceIds,
  membershipSync=syncPublishedVolleyballConferenceMembership,
  resultFallback=runMaxPrepsVolleyballResultFallback,
  rebuildRecords=rebuildTeamRecords
}={}) {
  const checkedAt=now.toISOString();
  const prior=await completionRow(env);
  if(prior?.last_successful_fetch_at) {
    return {status:"ALREADY_COMPLETE",stateId:STATE_ID,completedAt:prior.last_successful_fetch_at};
  }
  if(typeof refreshSourceIds!=="function") throw new Error("approved volleyball convergence requires bounded source refresh callback");

  const before=validateVolleyballConvergenceProof(await proofRows(env));

  let officialRefresh={status:"SKIPPED_ALREADY_FIXED",outcomes:[]};
  if(!(before.checks.conwayOverall&&before.checks.conwayLrChristian)) {
    officialRefresh=await refreshSourceIds([CONWAY_SOURCE],"approved-volleyball-production-convergence");
    const officialOutcome=(officialRefresh?.outcomes||[]).find(row=>row.sourceId===CONWAY_SOURCE);
    if(!officialOutcome || !["SUCCESS","NOT_MODIFIED"].includes(officialOutcome.status)) {
      throw new Error(`Conway official refresh failed: ${officialOutcome?.error||officialOutcome?.status||"source outcome missing"}`);
    }
  }

  let centralMembership={status:"SKIPPED_ALREADY_FIXED",assignments:0,conferenceWrites:0,teamWrites:0};
  if(!before.checks.southwestConference) {
    centralMembership=await membershipSync(env,{
      now,
      conferenceIds:["6a-central"],
      targetTeamIds:[SOUTHWEST_TEAM],
      conferenceSourceOverrides:{
        "6a-central":{name:"6A Central",source_url:SIX_A_CENTRAL_SOURCE_URL}
      }
    });
    if(!["SUCCESS","NOT_MODIFIED"].includes(centralMembership?.status)) {
      throw new Error(`Southwest conference membership sync did not succeed: ${centralMembership?.status||"unknown"} ${JSON.stringify(centralMembership?.failedConferences||[])}`);
    }
  }

  let threeATwoMembership={status:"SKIPPED_ALREADY_FIXED",assignments:0,conferenceWrites:0,teamWrites:0};
  if(!(before.checks.flippinConference&&before.checks.melbourneConference)) {
    threeATwoMembership=await membershipSync(env,{
      now,
      conferenceIds:["3a-2"],
      targetTeamIds:THREE_A_TWO_TEAMS,
      conferenceSourceOverrides:{
        "3a-2":{name:"3A 2",source_url:THREE_A_TWO_SOURCE_URL}
      }
    });
    if(!["SUCCESS","NOT_MODIFIED"].includes(threeATwoMembership?.status)) {
      throw new Error(`3A-2 conference membership sync did not succeed: ${threeATwoMembership?.status||"unknown"} ${JSON.stringify(threeATwoMembership?.failedConferences||[])}`);
    }
  }

  let historical={status:"SKIPPED_ALREADY_FIXED",dates:HISTORICAL_DATES,matchedFinals:0,touchedTeams:0,writes:0};
  if(!(before.checks.flippinOverall&&before.checks.flippinBergman&&before.checks.flippinCotter)) {
    historical=await resultFallback(env,{
      dates:HISTORICAL_DATES,
      now,
      targetTeamIds:[FLIPPIN_TEAM]
    });
    if(!["SUCCESS","NOT_MODIFIED"].includes(historical?.status)) {
      throw new Error(`Flippin historical result fallback did not succeed: ${historical?.status||"unknown"}`);
    }
  }

  const recordRebuild=await rebuildRecords(env,TARGET_TEAMS,checkedAt);
  const proof=validateVolleyballConvergenceProof(await proofRows(env));
  if(!proof.complete) {
    throw new Error(`volleyball production convergence proof failed: ${JSON.stringify(proof.checks)}`);
  }

  const details={
    status:"COMPLETE",
    checkedAt,
    beforeChecks:before.checks,
    officialRefresh:{status:officialRefresh.status||null,outcomes:officialRefresh?.outcomes||[]},
    centralMembership:{status:centralMembership.status,assignments:centralMembership.assignments,conferenceWrites:centralMembership.conferenceWrites??0,teamWrites:centralMembership.teamWrites??0},
    threeATwoMembership:{status:threeATwoMembership.status,assignments:threeATwoMembership.assignments,conferenceWrites:threeATwoMembership.conferenceWrites??0,teamWrites:threeATwoMembership.teamWrites??0},
    historical:{status:historical.status,dates:historical.dates,matchedFinals:historical.matchedFinals,touchedTeams:historical.touchedTeams,writes:historical.writes},
    recordRebuild,
    checks:proof.checks
  };
  await markComplete(env,checkedAt,details);
  return {status:"COMPLETE",stateId:STATE_ID,...details};
}

export {
  STATE_ID,
  CONWAY_TEAM,
  SOUTHWEST_TEAM,
  FLIPPIN_TEAM,
  MELBOURNE_TEAM,
  CONWAY_SOURCE,
  SIX_A_CENTRAL_SOURCE_URL,
  THREE_A_TWO_SOURCE_URL,
  THREE_A_TWO_TEAMS,
  TARGET_TEAMS,
  HISTORICAL_DATES
};
