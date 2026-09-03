import { ARKANSAS_COLLEGE_TEAM_INVENTORY } from "./college-team-inventory.js";

const SIDEARM = "sidearm";
const PRESTO = "prestosports";
const NAIA_PRESTO = "naia-stats-presto";
const NJCAA_PRESTO = "njcaa-stats-presto";
const CUSTOM = "custom";

// Read-only provider audit checkpoint, 2026-09-03. Classification here is
// intentionally stronger than a hostname guess: current public schedule/event
// evidence must identify the platform family. This file never mutates D1.
export const COLLEGE_SOURCE_PLATFORMS = [
  { schoolId:"uark", platform:CUSTOM, host:"arkansasrazorbacks.com", parserType:null, status:"needs-parser", evidencePath:"/sport/m-footbl/schedule/" },

  { schoolId:"arkansas-state", platform:SIDEARM, host:"astateredwolves.com", parserType:"sidearm", status:"parser-ready", evidencePath:"/sports/womens-soccer/schedule/2026" },
  { schoolId:"uapb", platform:SIDEARM, host:"uapblionsroar.com", parserType:"sidearm", status:"parser-ready", evidencePath:"/sports/womens-soccer/schedule/2026" },
  { schoolId:"uca", platform:SIDEARM, host:"ucasports.com", parserType:"sidearm", status:"parser-ready", evidencePath:"/sports/football/schedule/2026" },
  { schoolId:"little-rock", platform:SIDEARM, host:"lrtrojans.com", parserType:"sidearm", status:"parser-ready", evidencePath:"/sports/womens-soccer/schedule/2026" },
  { schoolId:"arkansas-tech", platform:SIDEARM, host:"arkansastechsports.com", parserType:"sidearm", status:"parser-ready", evidencePath:"/sports/football/schedule/2026" },
  { schoolId:"uafs", platform:SIDEARM, host:"uafortsmithlions.com", parserType:"sidearm", status:"parser-ready", evidencePath:"/sports/womens-volleyball/schedule/2026" },
  { schoolId:"uam", platform:SIDEARM, host:"www.uamsports.com", parserType:"sidearm", status:"parser-ready", evidencePath:"/sports/womens-volleyball/schedule/2026" },
  { schoolId:"harding", platform:SIDEARM, host:"hardingsports.com", parserType:"sidearm", status:"parser-ready", evidencePath:"/sports/football/schedule/2026" },
  { schoolId:"henderson-state", platform:SIDEARM, host:"hsusports.com", parserType:"sidearm", status:"parser-ready", evidencePath:"/sports/womens-volleyball/schedule/2026" },
  { schoolId:"ouachita-baptist", platform:SIDEARM, host:"obutigers.com", parserType:"sidearm", status:"parser-ready", evidencePath:"/sports/mens-soccer/schedule/2026" },
  { schoolId:"southern-arkansas", platform:SIDEARM, host:"muleriderathletics.com", parserType:"sidearm", status:"parser-ready", evidencePath:"/sports/football/schedule/2026" },
  { schoolId:"hendrix", platform:SIDEARM, host:"hendrixwarriors.com", parserType:"sidearm", status:"parser-ready", evidencePath:"/sports/womens-volleyball/schedule/2026" },
  { schoolId:"lyon", platform:SIDEARM, host:"lyonscots.com", parserType:"sidearm", status:"parser-ready", evidencePath:"/sports/womens-volleyball/schedule/2026" },
  { schoolId:"ozarks", platform:SIDEARM, host:"uofoathletics.com", parserType:"sidearm", status:"parser-ready", evidencePath:"/sports/womens-volleyball/schedule/2026" },
  { schoolId:"arkansas-baptist", platform:SIDEARM, host:"abcbuffaloes.com", parserType:"sidearm", status:"parser-ready", evidencePath:"/sports/football/schedule/2026" },
  { schoolId:"john-brown", platform:SIDEARM, host:"jbuathletics.com", parserType:"sidearm", status:"parser-ready", evidencePath:"/sports/womens-volleyball/schedule/2026" },
  { schoolId:"ecclesia", platform:SIDEARM, host:"goroyals.org", parserType:"sidearm", status:"parser-ready", evidencePath:"/sports/mens-soccer/schedule" },

  // Champion's own athletics site is PrestoSports. The provider documents
  // standard schedule/composite RSS feeds, so one reusable RSS parser can cover
  // all five supported Champion teams after exact-feed live proof.
  { schoolId:"champion-christian", platform:PRESTO, host:"championchristian.prestosports.com", parserType:"prestosports-rss", status:"feed-ready-parser-needed", evidencePath:"/sports/mbkb/2025-26/schedule" },

  // NAIA Stats is a PrestoSports-hosted shared authority. These Arkansas schools
  // have current schedule/result evidence there. Exact 2026-27 sport feeds still
  // require live proof before any source row is created or enabled.
  { schoolId:"cbc", platform:NAIA_PRESTO, host:"naiastats.prestosports.com", parserType:"prestosports-rss", status:"bulk-feed-candidate", conferenceKey:"American_Midwest", evidencePath:"/sports/mbkb/2025-26/conf/American_Midwest/schedule" },
  { schoolId:"crowleys-ridge", platform:NAIA_PRESTO, host:"naiastats.prestosports.com", parserType:"prestosports-rss", status:"bulk-feed-candidate", conferenceKey:"American_Midwest", evidencePath:"/sports/wbkb/2025-26" },
  { schoolId:"williams-baptist", platform:NAIA_PRESTO, host:"naiastats.prestosports.com", parserType:"prestosports-rss", status:"bulk-feed-candidate", conferenceKey:"American_Midwest", evidencePath:"/sports/bsb/2025-26/conf/americanmidwest/schedule" },
  { schoolId:"philander-smith", platform:NAIA_PRESTO, host:"naiastats.prestosports.com", parserType:"prestosports-rss", status:"bulk-feed-candidate", conferenceKey:"hbcuathleticconference", evidencePath:"/sports/bsb/2025-26/conf/hbcuathleticconference/schedule" },

  // NJCAA Stats is also PrestoSports-hosted and is the preferred shared
  // authority for the Arkansas two-year target set. This avoids independent
  // Localist/WordPress/Apptegy/institutional scrapers for the same schedules.
  // Division/sport feed keys are deliberately not guessed here; those are the
  // next live-proof step before source certification.
  { schoolId:"asu-mid-south", platform:NJCAA_PRESTO, host:"njcaastats.prestosports.com", parserType:"prestosports-rss", status:"bulk-feed-candidate", fallbackHost:"events.asumidsouth.edu" },
  { schoolId:"asu-mountain-home", platform:NJCAA_PRESTO, host:"njcaastats.prestosports.com", parserType:"prestosports-rss", status:"no-supported-teams" },
  { schoolId:"asu-newport", platform:NJCAA_PRESTO, host:"njcaastats.prestosports.com", parserType:"prestosports-rss", status:"bulk-feed-candidate", fallbackHost:"arkansasstatenewport.prestosports.com" },
  { schoolId:"asu-three-rivers", platform:NJCAA_PRESTO, host:"njcaastats.prestosports.com", parserType:"prestosports-rss", status:"no-supported-teams" },
  { schoolId:"national-park", platform:NJCAA_PRESTO, host:"njcaastats.prestosports.com", parserType:"prestosports-rss", status:"bulk-feed-candidate" },
  { schoolId:"north-arkansas", platform:NJCAA_PRESTO, host:"njcaastats.prestosports.com", parserType:"prestosports-rss", status:"bulk-feed-candidate", fallbackHost:"northark.edu" },
  { schoolId:"nwacc", platform:NJCAA_PRESTO, host:"njcaastats.prestosports.com", parserType:"prestosports-rss", status:"bulk-feed-candidate", fallbackHost:"nwacc.edu" },
  { schoolId:"shorter", platform:NJCAA_PRESTO, host:"njcaastats.prestosports.com", parserType:"prestosports-rss", status:"bulk-feed-candidate", fallbackHost:"shortercollege.edu" },
  { schoolId:"south-arkansas", platform:NJCAA_PRESTO, host:"njcaastats.prestosports.com", parserType:"prestosports-rss", status:"bulk-feed-candidate", fallbackHost:"southarkstars.com" },
  { schoolId:"seark", platform:NJCAA_PRESTO, host:"njcaastats.prestosports.com", parserType:"prestosports-rss", status:"bulk-feed-candidate", fallbackHost:"seark.edu" },
  { schoolId:"sau-tech", platform:NJCAA_PRESTO, host:"njcaastats.prestosports.com", parserType:"prestosports-rss", status:"bulk-feed-candidate", fallbackHost:"sautrockets.com" },
  { schoolId:"ua-rich-mountain", platform:NJCAA_PRESTO, host:"njcaastats.prestosports.com", parserType:"prestosports-rss", status:"bulk-feed-candidate", fallbackHost:"uarichmountain.edu" },
  { schoolId:"ua-cossatot", platform:NJCAA_PRESTO, host:"njcaastats.prestosports.com", parserType:"prestosports-rss", status:"bulk-feed-candidate", fallbackHost:"uacossatot.prestosports.com" }
];

const bySchool = new Map(COLLEGE_SOURCE_PLATFORMS.map(row => [row.schoolId, row]));

export const SIDEARM_SPORT_PATH = Object.freeze({
  "football|men": "football",
  "basketball|men": "mens-basketball",
  "basketball|women": "womens-basketball",
  "soccer|men": "mens-soccer",
  "soccer|women": "womens-soccer",
  "volleyball|women": "womens-volleyball"
});

export const PRESTO_SPORT_PATH = Object.freeze({
  "basketball|men": "mbkb",
  "basketball|women": "wbkb",
  "soccer|men": "msoc",
  "soccer|women": "wsoc",
  "volleyball|women": "wvball"
});

function academicSeason(season) {
  const start = Number(season);
  if (!Number.isInteger(start)) throw new Error(`Invalid college season ${season}`);
  return `${start}-${String(start + 1).slice(-2)}`;
}

export function sidearmScheduleUrl(platform, team, season = "2026") {
  if (platform?.parserType !== "sidearm") return null;
  const sportPath = SIDEARM_SPORT_PATH[`${team.sport}|${team.gender}`];
  if (!sportPath) return null;
  const seasonPath = team.sport === "basketball" ? academicSeason(season) : season;
  return `https://${platform.host}/sports/${sportPath}/schedule/${seasonPath}`;
}

export function prestoRssScheduleUrl(platform, team, season = "2026") {
  if (platform?.platform !== PRESTO || platform?.parserType !== "prestosports-rss") return null;
  const sportPath = PRESTO_SPORT_PATH[`${team.sport}|${team.gender}`];
  if (!sportPath) return null;
  return `https://${platform.host}/sports/${sportPath}/${academicSeason(season)}/schedule?print=rss`;
}

export function collegeSourceAuditSummary() {
  const summary = {
    schools: COLLEGE_SOURCE_PLATFORMS.length,
    parserReadySchools:0, parserReadyTeams:0,
    feedReadyParserNeededSchools:0, feedReadyParserNeededTeams:0,
    bulkFeedCandidateSchools:0, bulkFeedCandidateTeams:0,
    needsParserSchools:0, needsParserTeams:0,
    noSupportedTeamSchools:0,
    pendingTeams:0, totalTeams:0
  };

  for (const school of ARKANSAS_COLLEGE_TEAM_INVENTORY) {
    const platform = bySchool.get(school.schoolId);
    if (!platform) continue;
    const n = school.teams.length;
    if (platform.status === "parser-ready") {
      summary.parserReadySchools += 1; summary.parserReadyTeams += n;
    } else if (platform.status === "feed-ready-parser-needed") {
      summary.feedReadyParserNeededSchools += 1; summary.feedReadyParserNeededTeams += n;
    } else if (platform.status === "bulk-feed-candidate") {
      summary.bulkFeedCandidateSchools += 1; summary.bulkFeedCandidateTeams += n;
    } else if (platform.status === "needs-parser") {
      summary.needsParserSchools += 1; summary.needsParserTeams += n;
    } else if (platform.status === "no-supported-teams") {
      summary.noSupportedTeamSchools += 1;
    } else {
      summary.pendingTeams += n;
    }
    summary.totalTeams += n;
  }
  return summary;
}

export function parserReadyCollegeSourceCandidates(season = "2026") {
  const candidates = [];
  for (const school of ARKANSAS_COLLEGE_TEAM_INVENTORY) {
    const platform = bySchool.get(school.schoolId);
    if (platform?.status !== "parser-ready") continue;
    for (const team of school.teams) {
      candidates.push({
        schoolId: school.schoolId,
        sport: team.sport,
        gender: team.gender,
        season,
        sourceUrl: sidearmScheduleUrl(platform, team, season),
        sourceType: "official-athletics",
        parserType: "sidearm",
        certificationState: "platform-ready-source-pending-live-proof"
      });
    }
  }
  return candidates;
}

export function prestoCollegeSourceCandidates(season = "2026") {
  const candidates = [];
  for (const school of ARKANSAS_COLLEGE_TEAM_INVENTORY) {
    const platform = bySchool.get(school.schoolId);
    if (platform?.status !== "feed-ready-parser-needed") continue;
    for (const team of school.teams) {
      const sourceUrl = prestoRssScheduleUrl(platform, team, season);
      if (!sourceUrl) throw new Error(`Unsupported PrestoSports target ${school.schoolId}:${team.sport}:${team.gender}`);
      candidates.push({
        schoolId: school.schoolId,
        sport: team.sport,
        gender: team.gender,
        season,
        sourceUrl,
        sourceType: "official-athletics",
        parserType: "prestosports-rss",
        certificationState: "feed-identified-parser-pending-live-proof"
      });
    }
  }
  return candidates;
}

export function bulkCollegeTargetSummary() {
  const schools = ARKANSAS_COLLEGE_TEAM_INVENTORY.filter(school => bySchool.get(school.schoolId)?.status === "bulk-feed-candidate");
  return {
    schools: schools.length,
    teams: schools.reduce((sum, school) => sum + school.teams.length, 0),
    naiaSchools: schools.filter(school => bySchool.get(school.schoolId)?.platform === NAIA_PRESTO).length,
    njcaaSchools: schools.filter(school => bySchool.get(school.schoolId)?.platform === NJCAA_PRESTO).length
  };
}
