import { rebuildTeamRecords } from "./record-rebuild.js";
import { reconcileResolvedObservation, upsertResolvedObservation } from "./canonical-observation-writer.js";

const FALSE_CANONICAL_ID="ce:volleyball:girls:2026:df-7x4sxh:df-ht8yyh:20260824:t1800";
const PEA_PROVIDENCE_CANONICAL_ID="ce:volleyball:girls:2026:df-7x4sxh:df-k7ketx:20260824:df-69b361f98d3c020536000002";
const HARRISON_VALLEY_CANONICAL_ID="ce:volleyball:girls:2026:df-ht8yyh:df-t5drr3:20260824:df-697285d2b5fdd10017000004";
const TRUE_CANONICAL_ID="ce:volleyball:girls:2026:df-dxgr8r:df-rpnt3m:20260903:t1830";
const PEA_TEAM="df-7x4sxh-volleyball-2026";
const HARRISON_TEAM="df-ht8yyh-volleyball-2026";
const MOUNTAIN_HOME_TEAM="df-dxgr8r-volleyball-2026";
const BATESVILLE_TEAM="df-rpnt3m-volleyball-2026";
const PEA_SOURCE="df-7x4sxh-volleyball-2026-official-school-results";
const BATES_CONTEST_ID="00105e4c-b8a6-4025-b5a8-bd4d035ecebc";
const FINGERPRINT="m7-final-three-corrections-v3";
const MAX_PLAN_READS=5000;
const AUG_START="2026-08-24T05:00:00.000Z";
const AUG_END="2026-08-25T05:00:00.000Z";
const SEP_START="2026-09-03T05:00:00.000Z";
const SEP_END="2026-09-04T05:00:00.000Z";

function rr(x){return Number(x?.meta?.rows_read||0);}
function rw(x){return Number(x?.meta?.rows_written||0);}
function norm(v){return String(v||"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();}
function one(rows,pred){const out=(rows||[]).filter(pred);return out.length===1?out[0]:null;}
function matchesName(name,aliases){const n=norm(name);return aliases.some(a=>n===a||n.startsWith(`${a} `));}
function resolveSchoolTeam(rows,aliases){const matches=rows.filter(r=>matchesName(r.name,aliases));return matches.length===1?matches[0]:null;}

function canonicalCandidate(rows,teamId,{teamScore,opponentScore,opponentNames,expectedCanonicalId}){
  if(!teamId) return {one:null,canonicalId:null,observations:0};
  const matches=rows.filter(r=>r.team_id===teamId&&r.status==="FINAL"&&Number(r.team_score)===teamScore&&Number(r.opponent_score)===opponentScore&&opponentNames.some(n=>norm(r.opponent).includes(n)));
  if(!matches.length) return {one:null,canonicalId:null,observations:0};
  const canonicalIds=[...new Set(matches.map(r=>r.canonical_event_id).filter(Boolean))];
  if(canonicalIds.length===1&&canonicalIds[0]===expectedCanonicalId){
    return {one:matches[0],canonicalId:canonicalIds[0],observations:matches.length};
  }
  return {one:null,canonicalId:null,observations:matches.length,multiple:matches,canonicalIds};
}

async function loadState(env){
  const schoolTeams=await env.DB.prepare(`SELECT s.id AS school_id,s.name,t.id AS team_id
    FROM teams t JOIN schools s ON s.id=t.school_id
    WHERE t.sport='volleyball' AND t.gender='girls' AND t.season='2026' AND t.active=1 AND s.state='AR'
    ORDER BY s.name,t.id`).all();
  const schoolRows=schoolTeams.results||[];
  const providence=resolveSchoolTeam(schoolRows,["providence classical christian academy","providence academy","providence"]);
  const valley=resolveSchoolTeam(schoolRows,["valley springs high school","valley springs"]);
  const providenceTeam=providence?.team_id||"__missing_providence__";
  const valleyTeam=valley?.team_id||"__missing_valley__";

  const [falseRows,trueRows,augGames,batesDay,conflicts]=await env.DB.batch([
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
      FROM games WHERE scheduled_at>=? AND scheduled_at<? AND team_id IN (?,?,?,?) ORDER BY team_id,scheduled_at,id`)
      .bind(AUG_START,AUG_END,PEA_TEAM,HARRISON_TEAM,providenceTeam,valleyTeam),
    env.DB.prepare(`SELECT id,team_id,source_id,source_event_key,opponent,opponent_school_id,scheduled_at,status,
      team_score,opponent_score,result,counts_for_record,canonical_event_id,home_away
      FROM games WHERE team_id=? AND scheduled_at>=? AND scheduled_at<? ORDER BY scheduled_at,id`)
      .bind(BATESVILLE_TEAM,SEP_START,SEP_END),
    env.DB.prepare(`SELECT canonical_event_id,conflict_type FROM event_conflicts
      WHERE canonical_event_id IN (?,?,?,?) AND resolved_at IS NULL ORDER BY canonical_event_id,id`)
      .bind(FALSE_CANONICAL_ID,PEA_PROVIDENCE_CANONICAL_ID,HARRISON_VALLEY_CANONICAL_ID,TRUE_CANONICAL_ID)
  ]);
  const results=[schoolTeams,falseRows,trueRows,augGames,batesDay,conflicts];
  const d1={statements:results.length,rows_read:results.reduce((s,r)=>s+rr(r),0),rows_written:results.reduce((s,r)=>s+rw(r),0),
    per_statement:results.map(r=>({rows_read:rr(r),rows_written:rw(r)}))};
  return {falseRows:falseRows.results||[],trueRows:trueRows.results||[],providence,valley,augGames:augGames.results||[],batesDay:batesDay.results||[],conflicts:conflicts.results||[],d1};
}

function classify(state){
  const reasons=[];
  if(state.d1.rows_written!==0) reasons.push(`preflight wrote ${state.d1.rows_written}`);
  if(state.d1.rows_read>MAX_PLAN_READS) reasons.push(`preflight read fuse exceeded ${state.d1.rows_read}`);
  const providence=state.providence, valley=state.valley;
  if(!providence) reasons.push("could not uniquely resolve Providence Academy active 2026 volleyball team");
  if(!valley) reasons.push("could not uniquely resolve Valley Springs active 2026 volleyball team");

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

  const pea=canonicalCandidate(state.augGames,PEA_TEAM,{teamScore:2,opponentScore:3,opponentNames:["providence"],expectedCanonicalId:PEA_PROVIDENCE_CANONICAL_ID});
  const prov=canonicalCandidate(state.augGames,providence?.team_id,{teamScore:3,opponentScore:2,opponentNames:["pea ridge"],expectedCanonicalId:PEA_PROVIDENCE_CANONICAL_ID});
  const harrison=canonicalCandidate(state.augGames,HARRISON_TEAM,{teamScore:3,opponentScore:0,opponentNames:["valley springs"],expectedCanonicalId:HARRISON_VALLEY_CANONICAL_ID});
  const valleySide=canonicalCandidate(state.augGames,valley?.team_id,{teamScore:0,opponentScore:3,opponentNames:["harrison"],expectedCanonicalId:HARRISON_VALLEY_CANONICAL_ID});
  for(const [label,c,expected] of [
    ["Pea Ridge Providence",pea,PEA_PROVIDENCE_CANONICAL_ID],
    ["Providence Pea Ridge",prov,PEA_PROVIDENCE_CANONICAL_ID],
    ["Harrison Valley Springs",harrison,HARRISON_VALLEY_CANONICAL_ID],
    ["Valley Springs Harrison",valleySide,HARRISON_VALLEY_CANONICAL_ID]
  ]) {
    if(!c.one) reasons.push(`missing unique canonical proof for ${label} at ${expected}`);
  }

  const trueBase=state.trueRows[0]||null;
  const mhMember=one(state.trueRows,r=>r.reporting_team_id===MOUNTAIN_HOME_TEAM&&r.game_status==="FINAL"&&Number(r.team_score)===3&&Number(r.opponent_score)===0);
  const batesMember=one(state.trueRows,r=>r.reporting_team_id===BATESVILLE_TEAM&&r.game_status==="FINAL"&&Number(r.team_score)===0&&Number(r.opponent_score)===3);
  if(!trueBase||trueBase.canonical_status!=="FINAL"||trueBase.home_school_id!=="df-rpnt3m"||trueBase.away_school_id!=="df-dxgr8r"||Number(trueBase.home_score)!==0||Number(trueBase.away_score)!==3) reasons.push("Mountain Home/Batesville canonical no longer matches 3-0 final");
  if(!mhMember) reasons.push("Mountain Home member missing from proven Sep 3 final");
  const batesCandidates=state.batesDay.filter(r=>r.status==="FINAL"&&Number(r.team_score)===0&&Number(r.opponent_score)===3&&norm(r.opponent).includes("mountain home"));
  if(batesCandidates.length>1) reasons.push(`multiple Batesville 0-3 Mountain Home candidates=${batesCandidates.length}`);
  let batesAction="create_secondary_observation",batesGameId=null;
  if(batesMember){batesAction="already_attached";batesGameId=batesMember.game_id;}
  else if(batesCandidates.length===1){batesAction="reconcile_existing_observation";batesGameId=batesCandidates[0].id;}

  if(state.conflicts.length) reasons.push(`active target conflicts=${state.conflicts.length}`);

  return {safe:reasons.length===0,reasons,providence,valley,falseAction,falseGameId,batesAction,batesGameId,trueScheduledAt:trueBase?.canonical_scheduled_at||null,
    pea,prov,harrison,valleySide};
}

export async function planM7FinalTwoRepair(env){
  const state=await loadState(env);
  const c=classify(state);
  return {fingerprint:FINGERPRINT,safe:c.safe,reasons:c.reasons,false_action:c.falseAction,false_game_id:c.falseGameId,
    providence:c.providence,valley_springs:c.valley,
    pea_providence_action:c.pea.one?"already_attached":"missing",pea_providence_game_id:c.pea.one?.id||null,pea_providence_canonical_id:c.pea.canonicalId||null,pea_providence_observations:c.pea.observations,
    providence_pea_action:c.prov.one?"already_attached":"missing",providence_pea_game_id:c.prov.one?.id||null,providence_pea_canonical_id:c.prov.canonicalId||null,providence_pea_observations:c.prov.observations,
    harrison_valley_action:c.harrison.one?"already_attached":"missing",harrison_valley_game_id:c.harrison.one?.id||null,harrison_valley_canonical_id:c.harrison.canonicalId||null,harrison_valley_observations:c.harrison.observations,
    valley_harrison_action:c.valleySide.one?"already_attached":"missing",valley_harrison_game_id:c.valleySide.one?.id||null,valley_harrison_canonical_id:c.valleySide.canonicalId||null,valley_harrison_observations:c.valleySide.observations,
    batesville_action:c.batesAction,batesville_game_id:c.batesGameId,true_scheduled_at:c.trueScheduledAt,d1:state.d1};
}

async function ensureMaxPrepsSource(env,teamId,checkedAt){
  const id=`maxpreps-volleyball-results:${teamId}`;
  const url="https://www.maxpreps.com/ar/volleyball/scores/";
  await env.DB.prepare(`INSERT OR IGNORE INTO sources
    (id,team_id,source_url,source_type,source_priority,parser_type,parser_version,timezone,expected_min_games,refresh_minutes,
     active_result_minutes,enabled,authority_rank,stale_after_minutes,last_successful_fetch_at,last_checked_at,last_http_status,updated_at)
    VALUES(?,?,?,'secondary',9,'maxpreps-scores','1','America/Chicago',1,1440,60,0,80,2880,?,?,200,?)`)
    .bind(id,teamId,url,checkedAt,checkedAt,checkedAt).run();
  return {id,team_id:teamId,source_url:url};
}

async function verifyCanonicalPair(env,canonicalId,{teamA,teamB,homeSchoolId,awaySchoolId,homeScore,awayScore}){
  const result=await env.DB.prepare(`SELECT ce.id,ce.status,ce.home_school_id,ce.away_school_id,ce.home_score,ce.away_score,ce.conflict_count,
    cem.reporting_team_id,g.status AS game_status,g.team_score,g.opponent_score
    FROM canonical_events ce JOIN canonical_event_members cem ON cem.canonical_event_id=ce.id JOIN games g ON g.id=cem.game_id
    WHERE ce.id=? ORDER BY cem.reporting_team_id,cem.game_id`).bind(canonicalId).all();
  const rows=result.results||[];
  const teams=[...new Set(rows.map(r=>r.reporting_team_id))].sort();
  const expected=[teamA,teamB].sort();
  const base=rows[0];
  const ok=rows.length>=2&&JSON.stringify(teams)===JSON.stringify(expected)&&rows.every(r=>r.game_status==="FINAL")&&base?.status==="FINAL"&&base?.home_school_id===homeSchoolId&&base?.away_school_id===awaySchoolId&&Number(base?.home_score)===homeScore&&Number(base?.away_score)===awayScore&&Number(base?.conflict_count||0)===0;
  return {ok,rows,teams,member_count:rows.length,rows_read:rr(result)};
}

export async function executeM7FinalTwoRepair(env,{fingerprint,now=new Date()}={}){
  if(fingerprint!==FINGERPRINT) throw new Error("final corrections fingerprint mismatch");
  const plan=await planM7FinalTwoRepair(env);
  if(!plan.safe) throw new Error(`final corrections preflight unsafe: ${plan.reasons.join("; ")}`);
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

  let batesCanonical=TRUE_CANONICAL_ID;
  if(plan.batesville_action==="reconcile_existing_observation") batesCanonical=await reconcileResolvedObservation(env,plan.batesville_game_id);
  else if(plan.batesville_action==="create_secondary_observation"){
    const source=await ensureMaxPrepsSource(env,BATESVILLE_TEAM,checkedAt);
    const game={sourceEventKey:`native:${BATES_CONTEST_ID}`,opponent:"Mountain Home",scheduledAt:plan.true_scheduled_at,scheduledTimeKnown:false,venue:null,locationText:null,latitude:null,longitude:null,homeAway:"home",conferenceGame:false,countsForRecord:true,status:"FINAL",teamScore:0,opponentScore:3,result:"L",notes:"Bounded historical final repair from exact MaxPreps contest",sourceUpdatedAt:checkedAt};
    const gameId=await upsertResolvedObservation(env,source,game,checkedAt,{opponentSchoolId:"df-dxgr8r"});
    batesCanonical=await reconcileResolvedObservation(env,gameId);
  }
  if(batesCanonical!==TRUE_CANONICAL_ID) throw new Error(`Batesville reconciliation changed canonical: ${batesCanonical}`);

  const touched=[PEA_TEAM,HARRISON_TEAM,MOUNTAIN_HOME_TEAM,BATESVILLE_TEAM];
  const recordResult=await rebuildTeamRecords(env,touched,checkedAt);
  if(Number(recordResult?.teams||0)!==4) throw new Error(`expected four rebuilt teams, got ${recordResult?.teams||0}`);

  const falseResult=await env.DB.prepare("SELECT COUNT(*) AS n FROM canonical_events WHERE id=?").bind(FALSE_CANONICAL_ID).all();
  const falseCount=Number(falseResult.results?.[0]?.n||0);
  const peaVerify=await verifyCanonicalPair(env,PEA_PROVIDENCE_CANONICAL_ID,{teamA:PEA_TEAM,teamB:plan.providence.team_id,homeSchoolId:"df-7x4sxh",awaySchoolId:plan.providence.school_id,homeScore:2,awayScore:3});
  const harrisonVerify=await verifyCanonicalPair(env,HARRISON_VALLEY_CANONICAL_ID,{teamA:HARRISON_TEAM,teamB:plan.valley_springs.team_id,homeSchoolId:"df-ht8yyh",awaySchoolId:plan.valley_springs.school_id,homeScore:3,awayScore:0});
  const batesVerify=await verifyCanonicalPair(env,TRUE_CANONICAL_ID,{teamA:MOUNTAIN_HOME_TEAM,teamB:BATESVILLE_TEAM,homeSchoolId:"df-rpnt3m",awaySchoolId:"df-dxgr8r",homeScore:0,awayScore:3});
  const reasons=[];
  if(falseCount!==0) reasons.push("false Pea Ridge/Harrison canonical still exists");
  if(!peaVerify.ok) reasons.push("Pea Ridge/Providence reciprocal final verification failed");
  if(!harrisonVerify.ok) reasons.push("Harrison/Valley Springs reciprocal final verification failed");
  if(!batesVerify.ok) reasons.push("Mountain Home/Batesville reciprocal final verification failed");
  if(reasons.length) throw new Error(reasons.join("; "));

  const verificationReads=rr(falseResult)+peaVerify.rows_read+harrisonVerify.rows_read+batesVerify.rows_read;
  return {status:"SUCCESS",fingerprint:FINGERPRINT,canonicals:{pea_providence:PEA_PROVIDENCE_CANONICAL_ID,harrison_valley:HARRISON_VALLEY_CANONICAL_ID,mountain_home_batesville:TRUE_CANONICAL_ID},
    preflight_d1:plan.d1,
    direct_write_telemetry:{statements:directWrites.length,rows_read:directWrites.reduce((s,r)=>s+rr(r),0),rows_written:directWrites.reduce((s,r)=>s+rw(r),0)},
    verification_telemetry:{rows_read:verificationReads,rows_written:0},
    record_result:recordResult,verification:{verified:true,false_canonical_removed:true,pea_providence:peaVerify,harrison_valley:harrisonVerify,mountain_home_batesville:batesVerify}};
}

export { FINGERPRINT as M7_FINAL_TWO_REPAIR_FINGERPRINT };
