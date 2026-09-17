import { reconcileResolvedObservation } from "./canonical-observation-writer.js";
import { rebuildTeamRecords } from "./record-rebuild.js";

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
