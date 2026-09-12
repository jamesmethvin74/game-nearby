import { rebuildTeamRecords } from "./record-rebuild.js";
import { reconcileResolvedObservation, upsertResolvedObservation } from "./canonical-observation-writer.js";

const FALSE_CANONICAL_ID="ce:volleyball:girls:2026:df-7x4sxh:df-ht8yyh:20260824:t1800";
const TRUE_CANONICAL_ID="ce:volleyball:girls:2026:df-dxgr8r:df-rpnt3m:20260903:t1830";
const PEA_TEAM="df-7x4sxh-volleyball-2026";
const HARRISON_TEAM="df-ht8yyh-volleyball-2026";
const MOUNTAIN_HOME_TEAM="df-dxgr8r-volleyball-2026";
const BATESVILLE_TEAM="df-rpnt3m-volleyball-2026";
const PEA_SOURCE="df-7x4sxh-volleyball-2026-official-school-results";
const MAXPREPS_BATES_SOURCE=`maxpreps-volleyball-results:${BATESVILLE_TEAM}`;
const MAXPREPS_CONTEST_ID="00105e4c-b8a6-4025-b5a8-bd4d035ecebc";
const FINGERPRINT="m7-final-two-repair-v1";
const MAX_PLAN_READS=5000;

function rr(x){return Number(x?.meta?.rows_read||0);}
function rw(x){return Number(x?.meta?.rows_written||0);}
function norm(v){return String(v||"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();}
function one(rows,pred){const out=(rows||[]).filter(pred);return out.length===1?out[0]:null;}

async function loadState(env){
  const augStart="2026-08-24T05:00:00.000Z",augEnd="2026-08-25T05:00:00.000Z";
  const sepStart="2026-09-03T05:00:00.000Z",sepEnd="2026-09-04T05:00:00.000Z";
  const [falseRows,trueRows,peaDay,harrisonDay,batesDay,conflicts]=await env.DB.batch([
    env.DB.prepare(`SELECT ce.id,ce.status AS canonical_status,ce.scheduled_at AS canonical_scheduled_at,
      ce.home_school_id,ce.away_school_id,ce.home_score,ce.away_score,ce.selected_source_id,
      cem.game_id,cem.reporting_team_id,g.team_id,g.source_id,g.source_event_key,g.opponent,
      g.opponent_school_id,g.status AS game_status,g.team_score,g.opponent_score,g.result,
      g.counts_for_record,g.canonical_event_id
      FROM canonical_events ce
      LEFT JOIN canonical_event_members cem ON cem.canonical_event_id=ce.id
      LEFT JOIN games g ON g.id=cem.game_id
      WHERE ce.id=? ORDER BY cem.game_id`).bind(FALSE_CANONICAL_ID),
    env.DB.prepare(`SELECT ce.id,ce.status AS canonical_status,ce.scheduled_at AS canonical_scheduled_at,
      ce.home_school_id,ce.away_school_id,ce.home_score,ce.away_score,ce.selected_source_id,
      cem.game_id,cem.reporting_team_id,g.team_id,g.source_id,g.source_event_key,g.opponent,
      g.opponent_school_id,g.status AS game_status,g.team_score,g.opponent_score,g.result,
      g.counts_for_record,g.canonical_event_id
      FROM canonical_events ce
      LEFT JOIN canonical_event_members cem ON cem.canonical_event_id=ce.id
      LEFT JOIN games g ON g.id=cem.game_id
      WHERE ce.id=? ORDER BY cem.game_id`).bind(TRUE_CANONICAL_ID),
    env.DB.prepare(`SELECT id,team_id,source_id,source_event_key,opponent,opponent_school_id,scheduled_at,status,
      team_score,opponent_score,result,counts_for_record,canonical_event_id,home_away
      FROM games WHERE team_id=? AND scheduled_at>=? AND scheduled_at<? ORDER BY scheduled_at,id`)
      .bind(PEA_TEAM,augStart,augEnd),
    env.DB.prepare(`SELECT id,team_id,source_id,source_event_key,opponent,opponent_school_id,scheduled_at,status,
      team_score,opponent_score,result,counts_for_record,canonical_event_id,home_away
      FROM games WHERE team_id=? AND scheduled_at>=? AND scheduled_at<? ORDER BY scheduled_at,id`)
      .bind(HARRISON_TEAM,augStart,augEnd),
    env.DB.prepare(`SELECT id,team_id,source_id,source_event_key,opponent,opponent_school_id,scheduled_at,status,
      team_score,opponent_score,result,counts_for_record,canonical_event_id,home_away
      FROM games WHERE team_id=? AND scheduled_at>=? AND scheduled_at<? ORDER BY scheduled_at,id`)
      .bind(BATESVILLE_TEAM,sepStart,sepEnd),
    env.DB.prepare(`SELECT canonical_event_id,conflict_type FROM event_conflicts
      WHERE canonical_event_id IN (?,?) AND resolved_at IS NULL ORDER BY canonical_event_id,id`)
      .bind(FALSE_CANONICAL_ID,TRUE_CANONICAL_ID)
  ]);
  const results=[falseRows,trueRows,peaDay,harrisonDay,batesDay,conflicts];
  const d1={statements:results.length,rows_read:results.reduce((s,r)=>s+rr(r),0),rows_written:results.reduce((s,r)=>s+rw(r),0),
    per_statement:results.map(r=>({rows_read:rr(r),rows_written:rw(r)}))};
  return {falseRows:falseRows.results||[],trueRows:trueRows.results||[],peaDay:peaDay.results||[],harrisonDay:harrisonDay.results||[],batesDay:batesDay.results||[],conflicts:conflicts.results||[],d1};
}

function classify(state){
  const reasons=[];
  if(state.d1.rows_written!==0) reasons.push(`preflight wrote ${state.d1.rows_written}`);
  if(state.d1.rows_read>MAX_PLAN_READS) reasons.push(`preflight read fuse exceeded ${state.d1.rows_read}`);

  const correctPea=one(state.peaDay,r=>r.status==="FINAL"&&Number(r.team_score)===2&&Number(r.opponent_score)===3&&norm(r.opponent).includes("providence"));
  const correctHarrison=one(state.harrisonDay,r=>r.status==="FINAL"&&Number(r.team_score)===3&&Number(r.opponent_score)===0&&norm(r.opponent).includes("valley springs"));
  if(!correctPea) reasons.push("missing unique Pea Ridge 2-3 Providence final on Aug 24");
  if(!correctHarrison) reasons.push("missing unique Harrison 3-0 Valley Springs final on Aug 24");

  let falseAction="already_removed",falseGameId=null;
  if(state.falseRows.length){
    if(state.falseRows.length!==1) reasons.push(`false canonical member rows=${state.falseRows.length}`);
    else {
      const r=state.falseRows[0];
      falseGameId=r.game_id;
      const valid=r.canonical_status==="FINAL"&&r.home_school_id==="df-ht8yyh"&&r.away_school_id==="df-7x4sxh"
        &&Number(r.home_score)===3&&Number(r.away_score)===0&&r.reporting_team_id===PEA_TEAM
        &&r.team_id===PEA_TEAM&&r.source_id===PEA_SOURCE&&r.source_event_key==="harrison|away|1"
        &&r.game_status==="FINAL"&&Number(r.team_score)===0&&Number(r.opponent_score)===3;
      if(!valid) reasons.push("Pea Ridge/Harrison false canonical no longer matches proven state");
      else falseAction="delete_false_event";
    }
  }

  const mhMember=one(state.trueRows,r=>r.reporting_team_id===MOUNTAIN_HOME_TEAM&&r.game_status==="FINAL"&&Number(r.team_score)===3&&Number(r.opponent_score)===0);
  const batesMember=one(state.trueRows,r=>r.reporting_team_id===BATESVILLE_TEAM&&r.game_status==="FINAL"&&Number(r.team_score)===0&&Number(r.opponent_score)===3);
  const trueBase=state.trueRows[0]||null;
  if(!trueBase||trueBase.canonical_status!=="FINAL"||trueBase.home_school_id!=="df-rpnt3m"||trueBase.away_school_id!=="df-dxgr8r"||Number(trueBase.home_score)!==0||Number(trueBase.away_score)!==3) {
    reasons.push("Mountain Home/Batesville canonical no longer matches 3-0 final");
  }
  if(!mhMember) reasons.push("Mountain Home member missing from proven Sep 3 final");

  const batesCandidates=state.batesDay.filter(r=>r.status==="FINAL"&&Number(r.team_score)===0&&Number(r.opponent_score)===3&&norm(r.opponent).includes("mountain home"));
  if(batesCandidates.length>1) reasons.push(`multiple Batesville 0-3 Mountain Home candidates=${batesCandidates.length}`);
  let batesAction="create_secondary_observation",batesGameId=null;
  if(batesMember){batesAction="already_attached";batesGameId=batesMember.game_id;}
  else if(batesCandidates.length===1){batesAction="reconcile_existing_observation";batesGameId=batesCandidates[0].id;}

  if(state.conflicts.length) reasons.push(`active conflicts=${state.conflicts.length}`);
  return {safe:reasons.length===0,reasons,falseAction,falseGameId,batesAction,batesGameId,correctPea,correctHarrison,trueScheduledAt:trueBase?.canonical_scheduled_at||null};
}

export async function planM7FinalTwoRepair(env){
  const state=await loadState(env);
  const c=classify(state);
  return {fingerprint:FINGERPRINT,safe:c.safe,reasons:c.reasons,false_action:c.falseAction,false_game_id:c.falseGameId,
    batesville_action:c.batesAction,batesville_game_id:c.batesGameId,correct_pea:c.correctPea,correct_harrison:c.correctHarrison,
    true_scheduled_at:c.trueScheduledAt,d1:state.d1};
}

async function ensureBatesvilleMaxPrepsSource(env,checkedAt){
  const url="https://www.maxpreps.com/ar/volleyball/scores/";
  await env.DB.prepare(`INSERT OR IGNORE INTO sources
    (id,team_id,source_url,source_type,source_priority,parser_type,parser_version,timezone,expected_min_games,refresh_minutes,
     active_result_minutes,enabled,authority_rank,stale_after_minutes,last_successful_fetch_at,last_checked_at,last_http_status,updated_at)
    VALUES(?,?,?,'secondary',9,'maxpreps-scores','1','America/Chicago',1,1440,60,0,80,2880,?,?,200,?)`)
    .bind(MAXPREPS_BATES_SOURCE,BATESVILLE_TEAM,url,checkedAt,checkedAt,checkedAt).run();
  return {id:MAXPREPS_BATES_SOURCE,team_id:BATESVILLE_TEAM,source_url:url};
}

export async function executeM7FinalTwoRepair(env,{fingerprint,now=new Date()}={}){
  if(fingerprint!==FINGERPRINT) throw new Error("final-two fingerprint mismatch");
  const plan=await planM7FinalTwoRepair(env);
  if(!plan.safe) throw new Error(`final-two preflight unsafe: ${plan.reasons.join("; ")}`);
  const checkedAt=now.toISOString();
  const directWrites=[];

  if(plan.false_action==="delete_false_event"){
    const results=await env.DB.batch([
      env.DB.prepare("DELETE FROM canonical_event_members WHERE canonical_event_id=? AND game_id=?").bind(FALSE_CANONICAL_ID,plan.false_game_id),
      env.DB.prepare("DELETE FROM games WHERE id=? AND team_id=? AND source_id=?").bind(plan.false_game_id,PEA_TEAM,PEA_SOURCE),
      env.DB.prepare("DELETE FROM canonical_events WHERE id=? AND NOT EXISTS (SELECT 1 FROM canonical_event_members WHERE canonical_event_id=?)").bind(FALSE_CANONICAL_ID,FALSE_CANONICAL_ID)
    ]);
    directWrites.push(...results);
  }

  let reconciledCanonical=TRUE_CANONICAL_ID;
  if(plan.batesville_action==="reconcile_existing_observation"){
    reconciledCanonical=await reconcileResolvedObservation(env,plan.batesville_game_id);
  } else if(plan.batesville_action==="create_secondary_observation"){
    const source=await ensureBatesvilleMaxPrepsSource(env,checkedAt);
    const game={sourceEventKey:`native:${MAXPREPS_CONTEST_ID}`,opponent:"Mountain Home",scheduledAt:plan.true_scheduled_at,
      scheduledTimeKnown:false,venue:null,locationText:null,latitude:null,longitude:null,homeAway:"home",conferenceGame:false,
      countsForRecord:true,status:"FINAL",teamScore:0,opponentScore:3,result:"L",notes:"Secondary final from MaxPreps exact historical repair",sourceUpdatedAt:checkedAt};
    const gameId=await upsertResolvedObservation(env,source,game,checkedAt,{opponentSchoolId:"df-dxgr8r"});
    reconciledCanonical=await reconcileResolvedObservation(env,gameId);
  }
  if(reconciledCanonical!==TRUE_CANONICAL_ID) throw new Error(`Batesville reconciliation changed canonical: ${reconciledCanonical}`);

  const recordResult=await rebuildTeamRecords(env,[PEA_TEAM,MOUNTAIN_HOME_TEAM,BATESVILLE_TEAM],checkedAt);
  const verification=await verifyM7FinalTwoRepair(env);
  if(!verification.verified) throw new Error(`final-two verification failed: ${verification.reasons.join("; ")}`);
  return {status:"SUCCESS",fingerprint:FINGERPRINT,direct_write_telemetry:{statements:directWrites.length,rows_read:directWrites.reduce((s,r)=>s+rr(r),0),rows_written:directWrites.reduce((s,r)=>s+rw(r),0)},
    batesville_action:plan.batesville_action,reconciled_canonical:reconciledCanonical,record_result:recordResult,verification};
}

export async function verifyM7FinalTwoRepair(env){
  const state=await loadState(env);
  const reasons=[];
  if(state.falseRows.length!==0) reasons.push(`false Pea Ridge/Harrison canonical still exists rows=${state.falseRows.length}`);
  const trueRows=state.trueRows;
  const teams=[...new Set(trueRows.map(r=>r.reporting_team_id).filter(Boolean))].sort();
  if(trueRows.length!==2) reasons.push(`Mountain Home/Batesville member rows=${trueRows.length}`);
  if(JSON.stringify(teams)!==JSON.stringify([BATESVILLE_TEAM,MOUNTAIN_HOME_TEAM].sort())) reasons.push(`unexpected reporting teams ${teams.join(",")}`);
  const base=trueRows[0];
  if(!base||base.canonical_status!=="FINAL"||Number(base.home_score)!==0||Number(base.away_score)!==3) reasons.push("Mountain Home/Batesville final not 0-3 home/away");
  const bates=one(trueRows,r=>r.reporting_team_id===BATESVILLE_TEAM&&r.game_status==="FINAL"&&Number(r.team_score)===0&&Number(r.opponent_score)===3);
  if(!bates) reasons.push("Batesville reciprocal final missing");
  const pea=one(state.peaDay,r=>r.status==="FINAL"&&Number(r.team_score)===2&&Number(r.opponent_score)===3&&norm(r.opponent).includes("providence"));
  const harrison=one(state.harrisonDay,r=>r.status==="FINAL"&&Number(r.team_score)===3&&Number(r.opponent_score)===0&&norm(r.opponent).includes("valley springs"));
  if(!pea) reasons.push("Pea Ridge Providence final missing after repair");
  if(!harrison) reasons.push("Harrison Valley Springs final missing after repair");
  return {verified:reasons.length===0,reasons,member_count:trueRows.length,reporting_teams:teams,pea_providence:pea||null,harrison_valley_springs:harrison||null,d1:state.d1};
}

export { FINGERPRINT as M7_FINAL_TWO_REPAIR_FINGERPRINT };
