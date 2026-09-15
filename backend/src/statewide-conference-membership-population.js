import { buildSchoolIdentityIndex, resolveSchoolIdentity } from "./school-identity-resolution.js";
import { STATEWIDE_MEMBERSHIP_SOURCES, fetchAllStatewideConferenceRosters } from "./statewide-conference-membership-source.js";
import { buildCollegeConferenceMembership } from "./college-conference-membership.js";
import { membershipCoverageReport, normalizeConferenceMembership } from "./conference-membership-truth.js";

const SEASON="2026";
const MAX_MEMBERSHIPS=1500;
const MAX_CONFERENCES=180;
const MAX_TEAM_POINTER_CHANGES=1500;

function clean(value){return String(value??"").replace(/\s+/g," ").trim();}
function safe(value){return clean(value).toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");}
function sourceKey(sport,gender){return `${sport}|${gender}`;}
function teamKey(schoolId,sport,gender){return `${schoolId}|${sport}|${gender}`;}
function isIndependentConference(conference){return /^(?:freelance|independent)$/i.test(clean(conference?.name)) || /^(?:freelance|independent)$/i.test(clean(conference?.id));}

function classificationParts(name="") {
  const text=clean(name);
  const match=text.match(/^(\d+A|Class\s+\w+)\b\s*(.*)$/i);
  return {classification:match?.[1]||null,division:match?.[2]||text||null};
}

function highSchoolConferenceId(conference,source) {
  const slug=safe(conference.id||conference.name);
  if(source.sport==="football" || source.sport==="volleyball") return `${slug}-${source.sport}`;
  return `${slug}-${source.sport}-${source.gender}`;
}

function hashText(value){
  let hash=2166136261;
  for(let i=0;i<value.length;i++){hash^=value.charCodeAt(i);hash=Math.imul(hash,16777619);}
  return (hash>>>0).toString(16).padStart(8,"0");
}

async function loadSnapshot(env,{season=SEASON}={}) {
  const [teamResult,identityResult,conferenceResult]=await Promise.all([
    env.DB.prepare(`
      SELECT t.id AS team_id,t.school_id,t.sport,t.gender,t.season,t.conference_id,
        s.id AS identity_school_id,s.name AS school_name,s.mascot,s.level,s.catalog_scope
      FROM teams t
      JOIN schools s ON s.id=t.school_id
      WHERE t.active=1 AND t.season=? AND s.catalog_scope='local'
      ORDER BY s.level,t.sport,t.gender,t.id
    `).bind(season).all(),
    env.DB.prepare(`
      SELECT 'school' AS identity_kind,id AS school_id,name AS observed_name,mascot,NULL AS normalized_alias
      FROM schools WHERE catalog_scope='local'
      UNION ALL
      SELECT 'alias',school_id,alias_text,NULL,normalized_alias FROM school_aliases
    `).all(),
    env.DB.prepare(`SELECT id,name,classification,standings_method,coverage_complete,source_url FROM conferences ORDER BY id`).all()
  ]);
  const schools=[];
  const aliases=[];
  for(const row of identityResult.results||[]) {
    if(row.identity_kind==="school") schools.push({id:row.school_id,name:row.observed_name,mascot:row.mascot});
    else aliases.push({school_id:row.school_id,alias_text:row.observed_name,normalized_alias:row.normalized_alias});
  }
  return {
    teams:teamResult.results||[],
    schools,aliases,
    conferences:conferenceResult.results||[],
    d1:{
      rows_read:Number(teamResult.meta?.rows_read||0)+Number(identityResult.meta?.rows_read||0)+Number(conferenceResult.meta?.rows_read||0),
      rows_written:Number(teamResult.meta?.rows_written||0)+Number(identityResult.meta?.rows_written||0)+Number(conferenceResult.meta?.rows_written||0),
      statements:3
    }
  };
}

export function buildHighSchoolMembershipPopulation({snapshot,sourceResults,verifiedAt}) {
  const localTeams=(snapshot.teams||[]).filter(row=>row.level==="high-school");
  const localByKey=new Map();
  for(const team of localTeams) {
    const key=teamKey(team.school_id,team.sport,team.gender);
    if(!localByKey.has(key)) localByKey.set(key,[]);
    localByKey.get(key).push(team);
  }
  const identityIndex=buildSchoolIdentityIndex({schools:snapshot.schools,aliases:snapshot.aliases});
  const candidates=new Map();
  const conferences=new Map();
  const problems=[];
  const sourceStats=[];

  for(const result of sourceResults) {
    const source=result.source;
    sourceStats.push({
      key:source.key,
      discovered_conferences:result.discovered_conferences,
      fetched_conferences:result.fetched_conferences,
      failed_conferences:result.failures.length,
      failures:result.failures
    });
    for(const roster of result.rosters||[]) {
      const conference=roster.conference;
      const independent=isIndependentConference(conference);
      const parts=classificationParts(conference.name);
      const localConferenceId=independent?null:highSchoolConferenceId(conference,source);
      if(localConferenceId) conferences.set(localConferenceId,{
        id:localConferenceId,name:conference.name,classification:parts.classification,
        standings_method:"calculated",coverage_complete:0,source_url:conference.source_url
      });
      for(const observedName of roster.schools||[]) {
        const identity=resolveSchoolIdentity({observedName},identityIndex);
        if(identity.status!=="resolved") {
          problems.push({type:"source_identity",source_key:source.key,conference_id:conference.id,school_name:observedName,status:identity.status,candidates:identity.candidateSchoolIds});
          continue;
        }
        const matches=localByKey.get(teamKey(identity.schoolId,source.sport,source.gender))||[];
        if(matches.length!==1) {
          problems.push({type:"local_team",source_key:source.key,conference_id:conference.id,school_name:observedName,school_id:identity.schoolId,team_count:matches.length,team_ids:matches.map(row=>row.team_id)});
          continue;
        }
        const team=matches[0];
        if(!candidates.has(team.team_id)) candidates.set(team.team_id,[]);
        candidates.get(team.team_id).push({
          team_id:team.team_id,
          membership_state:independent?"independent":"member",
          conference_id:localConferenceId,
          classification:parts.classification,
          division:parts.division,
          authority_provider:source.authorityProvider,
          authority_key:`${source.key}:${conference.id}`,
          source_url:conference.source_url,
          verified_at:verifiedAt
        });
      }
    }
  }

  const memberships=[];
  const assigned=new Set();
  for(const [teamId,rows] of candidates) {
    const signatures=[...new Set(rows.map(row=>`${row.membership_state}|${row.conference_id||""}`))];
    if(signatures.length!==1) {
      problems.push({type:"multiple_conferences",team_id:teamId,assignments:rows.map(row=>({state:row.membership_state,conference_id:row.conference_id,authority_key:row.authority_key}))});
      continue;
    }
    memberships.push(normalizeConferenceMembership(rows[0]));
    assigned.add(teamId);
  }

  const supported=new Map(STATEWIDE_MEMBERSHIP_SOURCES.map(row=>[sourceKey(row.sport,row.gender),row]));
  for(const team of localTeams) {
    const config=supported.get(sourceKey(team.sport,team.gender));
    if(!config || assigned.has(team.team_id)) continue;
    memberships.push(normalizeConferenceMembership({
      team_id:team.team_id,membership_state:"unknown",conference_id:null,
      classification:null,division:null,authority_provider:"maxpreps-current-roster-missing",
      authority_key:`${config.key}:unresolved`,source_url:config.directoryUrl,verified_at:verifiedAt
    }));
  }

  return {memberships,conferences:[...conferences.values()],problems,sourceStats};
}

function mergeCollegePopulation({snapshot,verifiedAt}) {
  const built=buildCollegeConferenceMembership({season:SEASON,verifiedAt});
  const activeCollege=new Map((snapshot.teams||[]).filter(row=>row.level==="college").map(row=>[row.team_id,row]));
  const inventoryByTeam=new Map(built.memberships.map(row=>[row.team_id,row]));
  const memberships=[];
  const missingInventory=[];
  const missingProduction=[];
  for(const [teamId,team] of activeCollege) {
    const row=inventoryByTeam.get(teamId);
    if(row) memberships.push(normalizeConferenceMembership(row));
    else {
      memberships.push(normalizeConferenceMembership({team_id:teamId,membership_state:"unknown",authority_provider:"college-inventory-missing",authority_key:`${SEASON}:${teamId}:unresolved`,source_url:null,verified_at:verifiedAt}));
      missingInventory.push(teamId);
    }
  }
  for(const teamId of inventoryByTeam.keys()) if(!activeCollege.has(teamId)) missingProduction.push(teamId);
  const used=new Set(memberships.filter(row=>row.conference_id).map(row=>row.conference_id));
  return {
    memberships,
    conferences:built.conferences.filter(row=>used.has(row.id)),
    unresolved:built.unresolved,
    missingInventory,
    missingProduction
  };
}

function comparePlan(snapshot,memberships,conferences) {
  const teamById=new Map(snapshot.teams.map(row=>[row.team_id,row]));
  const currentConference=new Map(snapshot.conferences.map(row=>[row.id,row]));
  const teamPointerChanges=[];
  for(const row of memberships) {
    const team=teamById.get(row.team_id);
    if(!team) continue;
    const expected=row.membership_state==="member"?row.conference_id:null;
    if(clean(team.conference_id)!==clean(expected)) teamPointerChanges.push({team_id:row.team_id,current_conference_id:team.conference_id||null,expected_conference_id:expected});
  }
  const conferenceChanges=[];
  for(const row of conferences) {
    const current=currentConference.get(row.id);
    if(!current || clean(current.name)!==clean(row.name) || clean(current.classification)!==clean(row.classification) || clean(current.source_url)!==clean(row.source_url) || clean(current.standings_method)!==clean(row.standings_method)) {
      conferenceChanges.push({id:row.id,exists:Boolean(current)});
    }
  }
  return {teamPointerChanges,conferenceChanges};
}

function assertFuses({memberships,conferences,comparison}) {
  if(memberships.length>MAX_MEMBERSHIPS) throw new Error(`membership fuse exceeded: ${memberships.length} > ${MAX_MEMBERSHIPS}`);
  if(conferences.length>MAX_CONFERENCES) throw new Error(`conference fuse exceeded: ${conferences.length} > ${MAX_CONFERENCES}`);
  if(comparison.teamPointerChanges.length>MAX_TEAM_POINTER_CHANGES) throw new Error(`team pointer fuse exceeded: ${comparison.teamPointerChanges.length} > ${MAX_TEAM_POINTER_CHANGES}`);
}

export async function planStatewideConferenceMembershipPopulation(env,{
  fetchFn=fetch,
  now=new Date(),
  sourceResults=null
}={}) {
  const verifiedAt=now.toISOString();
  const snapshot=await loadSnapshot(env,{season:SEASON});
  const highSchoolSources=sourceResults || await fetchAllStatewideConferenceRosters({fetchFn});
  const highSchool=buildHighSchoolMembershipPopulation({snapshot,sourceResults:highSchoolSources,verifiedAt});
  const college=mergeCollegePopulation({snapshot,verifiedAt});
  const byTeam=new Map();
  for(const row of [...highSchool.memberships,...college.memberships]) {
    if(byTeam.has(row.team_id)) throw new Error(`duplicate statewide membership team: ${row.team_id}`);
    byTeam.set(row.team_id,row);
  }
  const memberships=[...byTeam.values()].sort((a,b)=>a.team_id.localeCompare(b.team_id));
  const conferenceMap=new Map();
  for(const row of [...highSchool.conferences,...college.conferences]) conferenceMap.set(row.id,row);
  const conferences=[...conferenceMap.values()].sort((a,b)=>a.id.localeCompare(b.id));
  const comparison=comparePlan(snapshot,memberships,conferences);
  assertFuses({memberships,conferences,comparison});
  const coverage=membershipCoverageReport(memberships);
  const activeEligibleTeams=snapshot.teams.filter(row=>row.level==="college" || STATEWIDE_MEMBERSHIP_SOURCES.some(source=>source.sport===row.sport&&source.gender===row.gender)).length;
  const payload=JSON.stringify({conferences,memberships});
  return {
    status:"DRY_RUN",
    safe:highSchool.sourceStats.every(row=>row.failed_conferences===0) && coverage.invalid===0 && highSchool.problems.filter(row=>row.type==="multiple_conferences").length===0,
    season:SEASON,
    fingerprint:`m9-statewide-membership-${memberships.length}-${conferences.length}-${hashText(payload)}`,
    active_eligible_teams:activeEligibleTeams,
    memberships,
    conferences,
    coverage,
    high_school:{memberships:highSchool.memberships.length,problems:highSchool.problems,source_stats:highSchool.sourceStats},
    college:{memberships:college.memberships.length,unresolved:college.unresolved,missing_inventory:college.missingInventory,missing_production:college.missingProduction},
    planned:{
      conference_upserts:comparison.conferenceChanges.length,
      membership_upserts:memberships.length,
      team_pointer_changes:comparison.teamPointerChanges.length,
      team_pointer_change_rows:comparison.teamPointerChanges,
      data_write_upper_bound:comparison.conferenceChanges.length+memberships.length+comparison.teamPointerChanges.length,
      set_based_statements:3,
      migration:"0016_conference_membership_truth.sql"
    },
    d1:{...snapshot.d1,rows_written:0}
  };
}

export const STATEWIDE_MEMBERSHIP_WRITE_LIMITS=Object.freeze({
  max_memberships:MAX_MEMBERSHIPS,
  max_conferences:MAX_CONFERENCES,
  max_team_pointer_changes:MAX_TEAM_POINTER_CHANGES,
  set_based_statements:3
});
