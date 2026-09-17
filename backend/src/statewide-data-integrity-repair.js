import { reconcileResolvedObservation } from "./canonical-observation-writer.js";
import { rebuildTeamRecords } from "./record-rebuild.js";
import { PRESENTATION_SUPPRESSED_NOTE } from "./current-schedule-truth.js";

export const STATEWIDE_REPAIR_CODES=new Set([
  "SPLIT_CANONICAL_LOGICAL_GAME",
  "STALE_NONTERMINAL_TWIN_OF_FINAL",
  "DUPLICATE_SCHEDULE_ENTRY",
  "DISPLAY_FINAL_MISSING_SCORE",
  "PAST_DUE_NONTERMINAL_DISPLAY"
]);

const CANONICAL_REPAIR_CODES=new Set([
  "SPLIT_CANONICAL_LOGICAL_GAME",
  "STALE_NONTERMINAL_TWIN_OF_FINAL",
  "DUPLICATE_SCHEDULE_ENTRY"
]);

function blockingRepairIssues(audit={}) {
  return (audit.issues||[]).filter(issue=>issue?.severity==="blocking"&&STATEWIDE_REPAIR_CODES.has(issue.code));
}

export function buildStatewideRepairPlan(audit={},sources=[],{batchSize=16}={}) {
  const issues=blockingRepairIssues(audit);
  const affectedTeamIds=[...new Set(issues.map(issue=>String(issue.team_id||"")).filter(Boolean))];
  const affectedTeams=new Set(affectedTeamIds);
  const sourceIds=[...new Set((sources||[])
    .filter(source=>affectedTeams.has(String(source?.team_id||"")))
    .map(source=>String(source?.id||""))
    .filter(Boolean))];
  const issueCounts={};
  for(const issue of issues) issueCounts[issue.code]=(issueCounts[issue.code]||0)+1;
  const size=Math.max(1,Math.min(16,Number(batchSize)||16));
  const sourceBatches=[];
  for(let i=0;i<sourceIds.length;i+=size) sourceBatches.push(sourceIds.slice(i,i+size));
  return {
    issues,
    issueCounts,
    affectedTeamIds,
    sourceIds,
    sourceBatches,
    canonicalClusters:buildCanonicalRepairClusters(audit)
  };
}

export function buildCanonicalRepairClusters(audit={}) {
  const pairs=blockingRepairIssues(audit).filter(issue=>
    CANONICAL_REPAIR_CODES.has(issue.code)&&issue.game_id&&issue.other_game_id
  );
  const parent=new Map();
  const find=id=>{
    if(!parent.has(id)) parent.set(id,id);
    const p=parent.get(id);
    if(p!==id) parent.set(id,find(p));
    return parent.get(id);
  };
  const union=(a,b)=>{
    const ra=find(a),rb=find(b);
    if(ra!==rb) parent.set(rb,ra);
  };
  for(const issue of pairs) union(String(issue.game_id),String(issue.other_game_id));
  const clusters=new Map();
  for(const issue of pairs) {
    const root=find(String(issue.game_id));
    if(!clusters.has(root)) clusters.set(root,{gameIds:new Set(),teamIds:new Set(),codes:new Set()});
    const cluster=clusters.get(root);
    cluster.gameIds.add(String(issue.game_id));
    cluster.gameIds.add(String(issue.other_game_id));
    if(issue.team_id) cluster.teamIds.add(String(issue.team_id));
    cluster.codes.add(issue.code);
  }
  return [...clusters.values()].map(cluster=>({
    gameIds:[...cluster.gameIds],
    teamIds:[...cluster.teamIds],
    codes:[...cluster.codes].sort()
  }));
}

export async function loadAffectedTeamIdsForGameIds(env,gameIds=[]) {
  const ids=[...new Set((gameIds||[]).map(String).filter(Boolean))];
  if(!ids.length) return [];
  const {results=[]}=await env.DB.prepare(`
    WITH requested_games(id) AS (
      SELECT CAST(value AS TEXT)
      FROM json_each(?)
    )
    SELECT DISTINCT t.id AS reporting_team_id, opponent_team.id AS opponent_team_id
    FROM requested_games requested
    JOIN games g ON g.id=requested.id
    JOIN teams t ON t.id=g.team_id
    LEFT JOIN teams opponent_team
      ON opponent_team.school_id=g.opponent_school_id
     AND opponent_team.sport=t.sport
     AND opponent_team.gender=t.gender
     AND opponent_team.season=t.season`)
    .bind(JSON.stringify(ids)).all();
  return [...new Set(results.flatMap(row=>[row.reporting_team_id,row.opponent_team_id]).map(String).filter(Boolean))];
}

export async function reconcileAuditedCanonicalDefects(env,audit,{
  reconcile=reconcileResolvedObservation,
  rebuildRecords=rebuildTeamRecords,
  loadAffectedTeams=loadAffectedTeamIdsForGameIds
}={}) {
  const clusters=buildCanonicalRepairClusters(audit);
  const results=[];

  for(const cluster of clusters) {
    let canonicalEventId=null;
    let seedGameId=null;
    for(const gameId of cluster.gameIds) {
      canonicalEventId=await reconcile(env,gameId);
      if(canonicalEventId) {
        seedGameId=gameId;
        break;
      }
    }
    results.push({
      ...cluster,
      repaired:Boolean(canonicalEventId),
      seedGameId,
      canonicalEventId:canonicalEventId||null
    });
  }

  const repairedResults=results.filter(result=>result.repaired);
  const repairedGameIds=[...new Set(repairedResults.flatMap(result=>result.gameIds))];
  const auditedTeamIds=repairedResults.flatMap(result=>result.teamIds);
  const resolvedTeamIds=repairedGameIds.length?await loadAffectedTeams(env,repairedGameIds):[];
  const teamIds=[...new Set([...auditedTeamIds,...resolvedTeamIds].map(String).filter(Boolean))];
  const recordRebuild=teamIds.length
    ? await rebuildRecords(env,teamIds,new Date().toISOString())
    : {teams:0,scoredFinals:0,standings:{cohorts:0,standingsRows:0}};

  return {
    clustersExamined:clusters.length,
    clustersRepaired:repairedResults.length,
    affectedTeamIds:teamIds,
    results,
    recordRebuild
  };
}


function metaOf(result={}) {
  const meta=result?.meta||{};
  return {
    rows_read:meta.rows_read==null?0:Number(meta.rows_read),
    rows_written:meta.rows_written==null?0:Number(meta.rows_written),
    duration_ms:meta.duration==null?0:Number(meta.duration)
  };
}

function addMeta(total,result={}) {
  const meta=metaOf(result);
  total.rows_read+=meta.rows_read;
  total.rows_written+=meta.rows_written;
  total.duration_ms+=meta.duration_ms;
  total.statements++;
  return meta;
}

function completeCanonicalFinal(row={}) {
  return String(row.canonical_status||"").toUpperCase()==="FINAL"
    && row.canonical_home_score!=null
    && row.canonical_away_score!=null;
}

function completeRawFinal(row={}) {
  return String(row.raw_status||"").toUpperCase()==="FINAL"
    && row.raw_team_score!=null
    && row.raw_opponent_score!=null;
}

function canonicalCandidateScore(id,rows=[]) {
  let score=0;
  for(const row of rows) {
    if(String(row.canonical_event_id||"")!==id) continue;
    if(completeCanonicalFinal(row)) score=Math.max(score,10000);
    if(completeRawFinal(row)) score=Math.max(score,5000);
    if(Number(row.source_enabled)===1) score=Math.max(score,1000);
    const authority=Number(row.authority_rank);
    if(Number.isFinite(authority)) score=Math.max(score,Math.max(0,500-authority));
  }
  return score;
}

export function chooseCanonicalWinner(rows=[]) {
  const ids=[...new Set(rows.map(row=>String(row?.canonical_event_id||"")).filter(Boolean))];
  if(!ids.length) return null;
  return ids.sort((a,b)=>{
    const delta=canonicalCandidateScore(b,rows)-canonicalCandidateScore(a,rows);
    return delta || a.localeCompare(b);
  })[0];
}

function orientedRawFinal(row,winnerRow) {
  if(!completeRawFinal(row)||!winnerRow) return null;
  const school=String(row.reporting_school_id||"");
  const home=String(winnerRow.canonical_home_school_id||"");
  const away=String(winnerRow.canonical_away_school_id||"");
  if(!school||!home||!away) return null;
  if(school===home) return {home_score:Number(row.raw_team_score),away_score:Number(row.raw_opponent_score)};
  if(school===away) return {home_score:Number(row.raw_opponent_score),away_score:Number(row.raw_team_score)};
  return null;
}

function uniqueFinalPair(rows,winnerRow) {
  const pairs=new Map();
  for(const row of rows) {
    const pair=orientedRawFinal(row,winnerRow);
    if(!pair) continue;
    pairs.set(`${pair.home_score}:${pair.away_score}`,pair);
  }
  return pairs.size===1?[...pairs.values()][0]:null;
}

export function buildAuditedCanonicalMergePlan(audit={},rows=[]) {
  const byId=new Map((rows||[]).map(row=>[String(row.game_id||""),row]));
  const plans=[];
  for(const cluster of buildCanonicalRepairClusters(audit)) {
    const clusterRows=cluster.gameIds.map(id=>byId.get(String(id))).filter(Boolean);
    const winner=chooseCanonicalWinner(clusterRows);
    if(!winner) continue;
    const winnerRow=clusterRows.find(row=>String(row.canonical_event_id||"")===winner)||null;
    const loserCanonicalIds=[...new Set(clusterRows
      .map(row=>String(row.canonical_event_id||""))
      .filter(id=>id&&id!==winner))];
    const pair=completeCanonicalFinal(winnerRow)?null:uniqueFinalPair(clusterRows,winnerRow);
    plans.push({
      winner_canonical_id:winner,
      loser_canonical_ids:loserCanonicalIds,
      game_ids:[...new Set(cluster.gameIds.map(String))],
      team_ids:[...new Set(cluster.teamIds.map(String))],
      codes:[...cluster.codes],
      promote_final:pair
    });
  }
  return plans;
}

async function loadRepairRows(env,gameIds=[]) {
  const ids=[...new Set((gameIds||[]).map(String).filter(Boolean))];
  if(!ids.length) return {rows:[],meta:{rows_read:0,rows_written:0,duration_ms:0}};
  const result=await env.DB.prepare(`
    WITH requested(id) AS (
      SELECT CAST(value AS TEXT) FROM json_each(?)
    )
    SELECT
      g.id AS game_id,g.team_id,g.source_id,g.canonical_event_id,
      g.status AS raw_status,g.team_score AS raw_team_score,g.opponent_score AS raw_opponent_score,
      g.opponent_school_id,g.scheduled_at,g.notes,
      t.school_id AS reporting_school_id,t.sport,t.gender,t.season,
      src.enabled AS source_enabled,src.authority_rank,src.source_priority,
      ce.status AS canonical_status,ce.home_score AS canonical_home_score,ce.away_score AS canonical_away_score,
      ce.home_school_id AS canonical_home_school_id,ce.away_school_id AS canonical_away_school_id,
      ce.scheduled_at AS canonical_scheduled_at,ce.selected_source_id,ce.trust_state
    FROM requested requested
    JOIN games g ON g.id=requested.id
    JOIN teams t ON t.id=g.team_id
    JOIN sources src ON src.id=g.source_id
    LEFT JOIN canonical_events ce ON ce.id=g.canonical_event_id
    ORDER BY g.id
  `).bind(JSON.stringify(ids)).all();
  return {rows:result?.results||[],meta:metaOf(result)};
}
