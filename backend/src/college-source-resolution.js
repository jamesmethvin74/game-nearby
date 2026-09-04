import { ARKANSAS_COLLEGE_TEAM_INVENTORY } from "./college-team-inventory.js";
import {
  COLLEGE_SOURCE_PLATFORMS,
  blockedPrestoAuthorityTargets as baseBlockedPrestoAuthorityTargets,
  parserReadyCollegeSourceCandidates as baseParserReadyCollegeSourceCandidates
} from "./college-source-platforms.js";
import { prestoFallbackState, prestoFallbackSchoolIds } from "./college-presto-fallbacks.js";

const PRESTO_RSS = "prestosports-rss";
const schoolById = new Map(ARKANSAS_COLLEGE_TEAM_INVENTORY.map(row => [row.schoolId,row]));
const platformBySchool = new Map(COLLEGE_SOURCE_PLATFORMS.map(row => [row.schoolId,row]));
const teamKey = (schoolId,sport,gender,season="2026") => `${schoolId}|${sport}|${gender}|${season}`;

function fallbackCandidate(school,team,season) {
  const fallback=prestoFallbackState(school.schoolId,team.sport,team.gender);
  if (fallback?.state !== "ready") return null;
  return {
    schoolId:school.schoolId,
    sport:team.sport,
    gender:team.gender,
    season,
    sourceUrl:fallback.sourceUrl,
    sourceType:"official-athletics",
    parserType:PRESTO_RSS,
    certificationState:"parser-ready-live-proved"
  };
}

export function parserReadyCollegeSourceCandidates(season="2026") {
  const candidates=[...baseParserReadyCollegeSourceCandidates(season)];
  const seen=new Set(candidates.map(row=>teamKey(row.schoolId,row.sport,row.gender,row.season)));
  for (const schoolId of prestoFallbackSchoolIds()) {
    const school=schoolById.get(schoolId);
    if (!school) throw new Error(`Missing college inventory school ${schoolId}`);
    for (const team of school.teams) {
      const candidate=fallbackCandidate(school,team,season);
      if (!candidate) continue;
      const key=teamKey(candidate.schoolId,candidate.sport,candidate.gender,candidate.season);
      if (seen.has(key)) throw new Error(`Duplicate college source resolution ${key}`);
      seen.add(key);
      candidates.push(candidate);
    }
  }
  return candidates;
}

export function pendingPrestoFallbackTargets(season="2026") {
  const targets=[];
  for (const schoolId of prestoFallbackSchoolIds()) {
    const school=schoolById.get(schoolId);
    const platform=platformBySchool.get(schoolId);
    if (!school || !platform) continue;
    for (const team of school.teams) {
      const fallback=prestoFallbackState(schoolId,team.sport,team.gender);
      if (fallback?.state !== "pending") continue;
      targets.push({
        schoolId,
        sport:team.sport,
        gender:team.gender,
        season,
        sourceUrl:fallback.sourceUrl,
        authorityHost:platform.host,
        authorityPlatform:platform.platform,
        serverFetchable:true,
        certificationState:"fallback-reachable-schedule-unpublished"
      });
    }
  }
  return targets;
}

export function blockedPrestoAuthorityTargets(season="2026") {
  return baseBlockedPrestoAuthorityTargets().filter(row => {
    const fallback=prestoFallbackState(row.schoolId,row.sport,row.gender);
    return !fallback;
  }).map(row=>({...row,season}));
}

export function blockedPrestoAuthoritySummary(season="2026") {
  const targets=blockedPrestoAuthorityTargets(season);
  return {
    schools:new Set(targets.map(row=>row.schoolId)).size,
    teams:targets.length,
    naiaTeams:targets.filter(row=>row.authorityPlatform==="naia-stats-presto").length,
    njcaaTeams:targets.filter(row=>row.authorityPlatform==="njcaa-stats-presto").length,
    directPrestoTeams:targets.filter(row=>row.authorityPlatform==="prestosports").length
  };
}

export function pendingPrestoFallbackSummary(season="2026") {
  const targets=pendingPrestoFallbackTargets(season);
  return {
    schools:new Set(targets.map(row=>row.schoolId)).size,
    teams:targets.length
  };
}

export function collegeSourceAuditSummary(season="2026") {
  const ready=parserReadyCollegeSourceCandidates(season);
  const pending=pendingPrestoFallbackTargets(season);
  const blocked=blockedPrestoAuthorityTargets(season);
  const noSupported=ARKANSAS_COLLEGE_TEAM_INVENTORY.filter(row=>row.teams.length===0);
  const readySchools=new Set(ready.map(row=>row.schoolId));
  const pendingSchools=new Set(pending.map(row=>row.schoolId));
  const blockedSchools=new Set(blocked.map(row=>row.schoolId));
  const totalTeams=ARKANSAS_COLLEGE_TEAM_INVENTORY.reduce((sum,row)=>sum+row.teams.length,0);
  const resolved=ready.length+pending.length+blocked.length;
  if (resolved!==totalTeams) throw new Error(`College source resolution mismatch ${resolved}/${totalTeams}`);
  return {
    schools:ARKANSAS_COLLEGE_TEAM_INVENTORY.length,
    parserReadySchools:readySchools.size,
    parserReadyTeams:ready.length,
    blockedAuthoritySchools:blockedSchools.size,
    blockedAuthorityTeams:blocked.length,
    noSupportedTeamSchools:noSupported.length,
    pendingSchools:pendingSchools.size,
    pendingTeams:pending.length,
    totalTeams
  };
}

export { COLLEGE_SOURCE_PLATFORMS };
