import { listPublishedStandingsOptions, SPORTS } from "./published-standings.js";
import { durableConferenceIdForSport, loadStandingsTruth } from "./standings-truth.js";
import { schoolKey } from "./conference-standings-truth.js";

export const STANDINGS_READINESS_MAX_CONFERENCES=64;
export const STANDINGS_READINESS_CONCURRENCY=4;

function issue(code,severity,sport,conference,detail,extra={}) {
  return {
    code,severity,sport,
    conference_id:conference?.id||null,
    conference_name:conference?.name||conference?.id||null,
    detail,
    ...extra
  };
}

function hasPublishedEvidence(row={}) {
  return row.published_rank != null
    || row.published_conference_record != null
    || row.published_overall_record != null;
}

export function inspectStandingsPresentation(payload,{sport,conference}={}) {
  const issues=[];
  const rows=Array.isArray(payload?.standings)?payload.standings:[];
  const meta=payload?.conference||{};
  if(!rows.length) {
    issues.push(issue("STANDINGS_EMPTY","blocking",sport,conference,"Published conference option returned no app-visible standings rows."));
    return issues;
  }

  const seen=new Set();
  for(const row of rows) {
    const key=schoolKey(row.school_name);
    if(key) {
      if(seen.has(key)) {
        issues.push(issue("STANDINGS_DUPLICATE_TEAM","blocking",sport,conference,`${row.school_name}: duplicate app-visible standings row.`,{school_name:row.school_name}));
      }
      seen.add(key);
    }

    const published=hasPublishedEvidence(row);
    if(published && (row.display_conference_record == null || row.display_overall_record == null)) {
      issues.push(issue(
        "STANDINGS_PUBLISHED_VALUE_HIDDEN",
        "blocking",sport,conference,
        `${row.school_name}: published record evidence exists but the presentation value is withheld.`,
        {school_name:row.school_name}
      ));
    }
    if(row.display_conference_record == null || row.display_overall_record == null) {
      issues.push(issue(
        "STANDINGS_PRESENTATION_RECORD_MISSING",
        "blocking",sport,conference,
        `${row.school_name}: app-visible conference/overall record is missing.`,
        {school_name:row.school_name}
      ));
    }
  }

  if(meta.presentation_complete===false) {
    issues.push(issue("STANDINGS_PRESENTATION_INCOMPLETE","blocking",sport,conference,"Standings presentation contract is incomplete."));
  }

  if(String(sport).toLowerCase()==="football") {
    const expectedDurable=durableConferenceIdForSport(sport,conference?.id);
    if(meta.durable_conference_id && String(meta.durable_conference_id)!==expectedDurable) {
      issues.push(issue(
        "STANDINGS_CONFERENCE_ID_CONTRACT",
        "blocking",sport,conference,
        `Public conference ${conference?.id} resolved to ${meta.durable_conference_id}; expected ${expectedDurable}.`
      ));
    }
  }

  if(meta.presentation_method==="published" || meta.presentation_method==="mixed") {
    issues.push(issue(
      "STANDINGS_USING_PUBLISHED_FALLBACK",
      "warning",sport,conference,
      "Published standings are being shown while canonical local reconciliation is incomplete."
    ));
  }
  if(meta.membership_complete===false) {
    issues.push(issue(
      "STANDINGS_MEMBERSHIP_INCOMPLETE",
      "warning",sport,conference,
      `Durable membership is incomplete (${Number(meta.membership_truth?.explicit_members||0)}/${Number(meta.membership_truth?.expected_members||0)} verified).`
    ));
  }
  if(meta.result_evidence_complete===false) {
    issues.push(issue(
      "STANDINGS_RESULT_EVIDENCE_INCOMPLETE",
      "warning",sport,conference,
      "Canonical local result evidence is incomplete; presentation must use factual published fallback where needed."
    ));
  }
  return issues;
}

export async function buildStatewideStandingsReadinessAudit(env,{
  sports=SPORTS.map(row=>row.id),
  maxConferences=STANDINGS_READINESS_MAX_CONFERENCES,
  concurrency=STANDINGS_READINESS_CONCURRENCY,
  listOptions=listPublishedStandingsOptions,
  loadTruth=loadStandingsTruth
}={}) {
  const issues=[];
  const checked=[];
  const queue=[];

  for(const sport of sports) {
    let options;
    try {
      options=await listOptions({sport});
    } catch(error) {
      issues.push(issue("STANDINGS_OPTIONS_UNAVAILABLE","blocking",sport,null,String(error?.message||error)));
      continue;
    }
    const conferences=Array.isArray(options?.conferences)?options.conferences:[];
    if(conferences.length>maxConferences) {
      issues.push(issue("STANDINGS_AUDIT_FUSE","blocking",sport,null,`Conference count ${conferences.length} exceeds audit fuse ${maxConferences}.`));
      continue;
    }
    for(const conference of conferences) queue.push({sport,conference});
  }

  for(let start=0;start<queue.length;start+=Math.max(1,concurrency)) {
    const batch=queue.slice(start,start+Math.max(1,concurrency));
    const results=await Promise.all(batch.map(async ({sport,conference})=>{
      try {
        const payload=await loadTruth(env,{sport,conferenceId:conference.id,season:"2026"});
        return {sport,conference,payload};
      } catch(error) {
        return {sport,conference,error:String(error?.message||error)};
      }
    }));
    for(const result of results) {
      checked.push({sport:result.sport,conference_id:result.conference.id,conference_name:result.conference.name});
      if(result.error) {
        issues.push(issue("STANDINGS_UNAVAILABLE","blocking",result.sport,result.conference,result.error));
        continue;
      }
      issues.push(...inspectStandingsPresentation(result.payload,result));
    }
  }

  const blocking=issues.filter(row=>row.severity==="blocking");
  const warnings=issues.filter(row=>row.severity==="warning");
  const counts={};
  for(const row of issues) counts[row.code]=(counts[row.code]||0)+1;
  return {
    status:blocking.length?"BLOCKED":"READY",
    summary:{
      sports_examined:[...new Set(checked.map(row=>row.sport))],
      conferences_examined:checked.length,
      blocking_issues:blocking.length,
      warning_issues:warnings.length,
      issues_by_code:counts
    },
    issues,
    checked
  };
}
