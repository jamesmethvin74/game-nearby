import { ARKANSAS_COLLEGE_TEAM_INVENTORY } from "./college-team-inventory.js";

const SIDEARM = "sidearm";
const PRESTO = "prestosports";
const NAIA_PRESTO = "naia-stats-presto";
const CUSTOM = "custom";
const PENDING = "pending-audit";

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

  { schoolId:"asu-newport", platform:PRESTO, host:"arkansasstatenewport.prestosports.com", parserType:"prestosports-rss", status:"feed-ready-parser-needed", evidencePath:"/composite" },
  { schoolId:"ua-cossatot", platform:PRESTO, host:"uacossatot.prestosports.com", parserType:"prestosports-rss", status:"feed-ready-parser-needed", evidencePath:"/sports/msoc/2025-26/releases/20251025rbo616" },
  { schoolId:"champion-christian", platform:PRESTO, host:"championchristian.prestosports.com", parserType:"prestosports-rss", status:"feed-ready-parser-needed", evidencePath:"/sports/mbkb/2025-26/schedule" },

  // NAIA Stats is a PrestoSports-hosted shared authority. These four Arkansas
  // schools have current schedule/result evidence there. They remain bulk-feed
  // candidates until exact 2026-27 sport feed URLs are live-proved.
  { schoolId:"cbc", platform:NAIA_PRESTO, host:"naiastats.prestosports.com", parserType:"prestosports-rss", status:"bulk-feed-candidate", conferenceKey:"American_Midwest", evidencePath:"/sports/mbkb/2025-26/conf/American_Midwest/schedule" },
  { schoolId:"crowleys-ridge", platform:NAIA_PRESTO, host:"naiastats.prestosports.com", parserType:"prestosports-rss", status:"bulk-feed-candidate", conferenceKey:"American_Midwest", evidencePath:"/sports/wbkb/2025-26" },
  { schoolId:"williams-baptist", platform:NAIA_PRESTO, host:"naiastats.prestosports.com", parserType:"prestosports-rss", status:"bulk-feed-candidate", conferenceKey:"American_Midwest", evidencePath:"/sports/bsb/2025-26/conf/americanmidwest/schedule" },
  { schoolId:"philander-smith", platform:NAIA_PRESTO, host:"naiastats.prestosports.com", parserType:"prestosports-rss", status:"bulk-feed-candidate", conferenceKey:"hbcuathleticconference", evidencePath:"/sports/bsb/2025-26/conf/hbcuathleticconference/schedule" },

  { schoolId:"asu-mid-south", platform:"localist-events", host:"events.asumidsouth.edu", parserType:null, status:"shared-platform-candidate", evidencePath:"/event/asumidsouth.events.1242194" },
  { schoolId:"asu-mountain-home", platform:PENDING, host:"asumh.edu", parserType:null, status:"no-supported-teams" },
  { schoolId:"asu-three-rivers", platform:PENDING, host:"asutr.edu", parserType:null, status:"no-supported-teams" },
  { schoolId:"national-park", platform:PENDING, host:"np.edu", parserType:null, status:"pending-audit" },
  { schoolId:"north-arkansas", platform:"institutional-table", host:"northark.edu", parserType:null, status:"shared-platform-candidate", evidencePath:"/athletics/mens-basketball/" },
  { schoolId:"nwacc", platform:"institutional-calendar", host:"nwacc.edu", parserType:null, status:"shared-platform-candidate", evidencePath:"/calendar/athletics.html" },
  { schoolId:"shorter", platform:"wordpress-tribe-events", host:"shortercollege.edu", parserType:null, status:"shared-platform-candidate", evidencePath:"/events/category/sports/" },
  { schoolId:"south-arkansas", platform:"apptegy-thrillshare", host:"southarkstars.com", parserType:null, status:"shared-platform-candidate", evidencePath:"/events" },
  { schoolId:"seark", platform:PENDING, host:"seark.edu", parserType:null, status:"pending-audit" },
  { schoolId:"sau-tech", platform:CUSTOM, host:"sautrockets.com", parserType:null, status:"shared-platform-candidate", evidencePath:"/mens-basketball/" },
  { schoolId:"ua-rich-mountain", platform:PENDING, host:"uarichmountain.edu", parserType:null, status:"pending-audit" }
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
    sharedPlatformCandidateSchools:0, sharedPlatformCandidateTeams:0,
    needsParserSchools:0, needsParserTeams:0,
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
    } else if (platform.status === "shared-platform-candidate") {
      summary.sharedPlatformCandidateSchools += 1; summary.sharedPlatformCandidateTeams += n;
    } else if (platform.status === "needs-parser") {
      summary.needsParserSchools += 1; summary.needsParserTeams += n;
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
