function numeric(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function parseStandingsRecord(value = "") {
  const parts = String(value ?? "").match(/\d+/g)?.map(Number) || [];
  return {
    wins:numeric(parts[0]),
    losses:numeric(parts[1]),
    ties:numeric(parts[2]),
    games:parts.reduce((sum, part) => sum + numeric(part), 0)
  };
}

export function standingsRecordText(wins = 0, losses = 0, ties = 0) {
  const w=numeric(wins), l=numeric(losses), t=numeric(ties);
  return t ? `${w}-${l}-${t}` : `${w}-${l}`;
}

export function standingsPct(wins = 0, losses = 0, ties = 0) {
  const w=numeric(wins), l=numeric(losses), t=numeric(ties);
  const games=w+l+t;
  return games ? (w + 0.5*t) / games : 0;
}

function schoolKey(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/\b(?:senior|sr\.?)[\s-]+high[\s-]+school\b/g," ")
    .replace(/\bhigh[\s-]+school\b/g," ")
    .replace(/\bhs\b/g," ")
    .replace(/[^a-z0-9]+/g,"")
    .trim();
}

function rankSort(a,b) {
  const ar=parseStandingsRecord(a.conference_record);
  const br=parseStandingsRecord(b.conference_record);
  return standingsPct(br.wins,br.losses,br.ties)-standingsPct(ar.wins,ar.losses,ar.ties)
    || br.wins-ar.wins
    || ar.losses-br.losses
    || ar.ties-br.ties
    || String(a.school_name||"").localeCompare(String(b.school_name||""))
    || String(a.team_id||"").localeCompare(String(b.team_id||""));
}

export function rankCanonicalConferenceRows(rows = [], {
  membershipComplete = true,
  resultEvidenceComplete = true
} = {}) {
  const ordered=[...rows].sort(rankSort);
  const canRank=Boolean(membershipComplete && resultEvidenceComplete);
  let previousKey=null;
  let previousRank=null;
  return ordered.map((row,index) => {
    const record=parseStandingsRecord(row.conference_record);
    const recordKey=`${record.wins}-${record.losses}-${record.ties}`;
    let rank=null;
    let standingState="unavailable";
    let conferenceRecord=row.conference_record || standingsRecordText(record.wins,record.losses,record.ties);
    if (record.games === 0) {
      conferenceRecord=conferenceRecord || "0-0";
      standingState="not-started";
    } else if (canRank) {
      rank=recordKey===previousKey ? previousRank : index+1;
      standingState="ranked";
    }
    previousKey=recordKey;
    previousRank=rank;
    return {
      ...row,
      rank,
      conference_record:conferenceRecord,
      standing_state:standingState,
      standings_verified:canRank,
      membership_complete:Boolean(membershipComplete),
      result_evidence_complete:Boolean(resultEvidenceComplete)
    };
  });
}

function publishedMap(publishedRows = []) {
  const map=new Map();
  for (const row of publishedRows) {
    const key=schoolKey(row.school_name);
    if (key && !map.has(key)) map.set(key,row);
  }
  return map;
}

function recordsEqual(a,b) {
  const left=parseStandingsRecord(a);
  const right=parseStandingsRecord(b);
  return left.wins===right.wins && left.losses===right.losses && left.ties===right.ties;
}

export function crossCheckPublishedStandings(canonicalRows = [], publishedRows = []) {
  const publishedBySchool=publishedMap(publishedRows);
  return canonicalRows.map(row => {
    const source=publishedBySchool.get(schoolKey(row.school_name));
    if (!source) {
      return {
        ...row,
        published_cross_check:"missing",
        published_rank:null,
        published_conference_record:null,
        published_overall_record:null
      };
    }
    const conferenceAgree=recordsEqual(row.conference_record,source.conference_record);
    const overallAgree=recordsEqual(row.overall_record,source.overall_record);
    return {
      ...row,
      published_cross_check:conferenceAgree && overallAgree ? "verified" : "contradictory",
      published_rank:source.rank == null ? null : Number(source.rank),
      published_conference_record:source.conference_record ?? null,
      published_overall_record:source.overall_record ?? null,
      published_source_url:source.source_url ?? null,
      published_conference_agrees:conferenceAgree,
      published_overall_agrees:overallAgree
    };
  });
}

export function reconcileConferenceStandings({
  calculated = null,
  published = null,
  membershipComplete = false,
  resultEvidenceComplete = false
} = {}) {
  const localRows=Array.isArray(calculated?.standings) ? calculated.standings : [];
  const sourceRows=Array.isArray(published?.standings) ? published.standings : [];

  if (localRows.length) {
    const ranked=rankCanonicalConferenceRows(localRows,{ membershipComplete,resultEvidenceComplete });
    const checked=crossCheckPublishedStandings(ranked,sourceRows);
    return {
      ...(calculated || {}),
      conference:{
        ...(calculated?.conference || published?.conference || {}),
        standings_method:"calculated",
        coverage_complete:Boolean(membershipComplete && resultEvidenceComplete),
        membership_complete:Boolean(membershipComplete),
        result_evidence_complete:Boolean(resultEvidenceComplete),
        published_cross_check:sourceRows.length ? "available" : "unavailable"
      },
      standings:checked
    };
  }

  if (sourceRows.length) {
    return {
      ...(published || {}),
      conference:{
        ...(published?.conference || {}),
        standings_method:"source-published",
        coverage_complete:false,
        membership_complete:Boolean(membershipComplete),
        result_evidence_complete:Boolean(resultEvidenceComplete),
        source_published_only:true
      },
      standings:sourceRows.map(row => ({
        team_id:row.team_id ?? null,
        school_name:row.school_name ?? null,
        rank:null,
        conference_record:null,
        overall_record:null,
        standing_state:"source-published",
        standings_verified:false,
        method:"source-published",
        published_cross_check:"source-only",
        published_rank:row.rank == null ? null : Number(row.rank),
        published_conference_record:row.conference_record ?? null,
        published_overall_record:row.overall_record ?? null,
        published_source_url:row.source_url ?? published?.conference?.source_url ?? null
      }))
    };
  }

  return null;
}

export function cohortTruthState({
  expectedMembers = 0,
  explicitMembers = 0,
  unknownMembers = 0,
  invalidMemberships = 0,
  unresolvedFinals = 0,
  contradictoryFinals = 0,
  sourceGaps = 0
} = {}) {
  const expected=numeric(expectedMembers);
  const explicit=numeric(explicitMembers);
  const membershipComplete=expected > 0
    && explicit === expected
    && numeric(unknownMembers) === 0
    && numeric(invalidMemberships) === 0;
  const resultEvidenceComplete=numeric(unresolvedFinals) === 0
    && numeric(contradictoryFinals) === 0
    && numeric(sourceGaps) === 0;
  return {
    membership_complete:membershipComplete,
    result_evidence_complete:resultEvidenceComplete,
    coverage_complete:membershipComplete && resultEvidenceComplete,
    expected_members:expected,
    explicit_members:explicit,
    unknown_members:numeric(unknownMembers),
    invalid_memberships:numeric(invalidMemberships),
    unresolved_finals:numeric(unresolvedFinals),
    contradictory_finals:numeric(contradictoryFinals),
    source_gaps:numeric(sourceGaps)
  };
}

export { schoolKey };
