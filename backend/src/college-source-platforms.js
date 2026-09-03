import { ARKANSAS_COLLEGE_TEAM_INVENTORY } from "./college-team-inventory.js";
import { arkansasRazorbackScheduleUrl } from "./arkansas-razorbacks.js";

const SIDEARM = "sidearm";
const PRESTO = "prestosports";
const NAIA_PRESTO = "naia-stats-presto";
const NJCAA_PRESTO = "njcaa-stats-presto";
const ARKANSAS = "arkansas-razorbacks";
const PRESTO_BLOCKED = "authority-confirmed-fetch-blocked";

// Read-only provider audit checkpoint, 2026-09-03. Classification here is
// intentionally stronger than a hostname guess: current public schedule/event
// evidence must identify the platform family. Server-fetchability is tracked
// separately so an authoritative-but-challenged page can never be bootstrapped
// as a dead production source. This file never mutates D1.
export const COLLEGE_SOURCE_PLATFORMS = [
  { schoolId:"uark", platform:ARKANSAS, host:"arkansasrazorbacks.com", parserType:"arkansas-razorbacks", status:"parser-ready", serverFetchable:true, evidencePath:"/sport/m-footbl/schedule/" },

  { schoolId:"arkansas-state", platform:SIDEARM, host:"astateredwolves.com", parserType:"sidearm", status:"parser-ready", serverFetchable:true, evidencePath:"/sports/womens-soccer/schedule/2026" },
  { schoolId:"uapb", platform:SIDEARM, host:"uapblionsroar.com", parserType:"sidearm", status:"parser-ready", serverFetchable:true, evidencePath:"/sports/womens-soccer/schedule/2026" },
  { schoolId:"uca", platform:SIDEARM, host:"ucasports.com", parserType:"sidearm", status:"parser-ready", serverFetchable:true, evidencePath:"/sports/football/schedule/2026" },
  { schoolId:"little-rock", platform:SIDEARM, host:"lrtrojans.com", parserType:"sidearm", status:"parser-ready", serverFetchable:true, evidencePath:"/sports/womens-soccer/schedule/2026" },
  { schoolId:"arkansas-tech", platform:SIDEARM, host:"arkansastechsports.com", parserType:"sidearm", status:"parser-ready", serverFetchable:true, evidencePath:"/sports/football/schedule/2026" },
  { schoolId:"uafs", platform:SIDEARM, host:"uafortsmithlions.com", parserType:"sidearm", status:"parser-ready", serverFetchable:true, evidencePath:"/sports/womens-volleyball/schedule/2026" },
  { schoolId:"uam", platform:SIDEARM, host:"www.uamsports.com", parserType:"sidearm", status:"parser-ready", serverFetchable:true, evidencePath:"/sports/womens-volleyball/schedule/2026" },
  { schoolId:"harding", platform:SIDEARM, host:"hardingsports.com", parserType:"sidearm", status:"parser-ready", serverFetchable:true, evidencePath:"/sports/football/schedule/2026" },
  { schoolId:"henderson-state", platform:SIDEARM, host:"hsusports.com", parserType:"sidearm", status:"parser-ready", serverFetchable:true, evidencePath:"/sports/womens-volleyball/schedule/2026" },
  { schoolId:"ouachita-baptist", platform:SIDEARM, host:"obutigers.com", parserType:"sidearm", status:"parser-ready", serverFetchable:true, evidencePath:"/sports/mens-soccer/schedule/2026" },
  { schoolId:"southern-arkansas", platform:SIDEARM, host:"muleriderathletics.com", parserType:"sidearm", status:"parser-ready", serverFetchable:true, evidencePath:"/sports/football/schedule/2026" },
  { schoolId:"hendrix", platform:SIDEARM, host:"hendrixwarriors.com", parserType:"sidearm", status:"parser-ready", serverFetchable:true, evidencePath:"/sports/womens-volleyball/schedule/2026" },
  { schoolId:"lyon", platform:SIDEARM, host:"lyonscots.com", parserType:"sidearm", status:"parser-ready", serverFetchable:true, evidencePath:"/sports/womens-volleyball/schedule/2026" },
  { schoolId:"ozarks", platform:SIDEARM, host:"uofoathletics.com", parserType:"sidearm", status:"parser-ready", serverFetchable:true, evidencePath:"/sports/womens-volleyball/schedule/2026" },
  { schoolId:"arkansas-baptist", platform:SIDEARM, host:"abcbuffaloes.com", parserType:"sidearm", status:"parser-ready", serverFetchable:true, evidencePath:"/sports/football/schedule/2026" },
  { schoolId:"john-brown", platform:SIDEARM, host:"jbuathletics.com", parserType:"sidearm", status:"parser-ready", serverFetchable:true, evidencePath:"/sports/womens-volleyball/schedule/2026" },
  { schoolId:"ecclesia", platform:SIDEARM, host:"goroyals.org", parserType:"sidearm", status:"parser-ready", serverFetchable:true, evidencePath:"/sports/mens-soccer/schedule" },

  // PrestoSports is authoritative for these programs, but public HTML, RSS and
  // iCalendar all returned the provider's Cloudflare challenge to a normal
  // server-side client in the M3 read-only probe. Keep the authority mapping for
  // audit/cross-check use, but never expose it as a production source candidate.
  { schoolId:"champion-christian", platform:PRESTO, host:"championchristian.prestosports.com", parserType:null, status:PRESTO_BLOCKED, serverFetchable:false, fallbackHost:"champion.edu", evidencePath:"/sports/mbkb/2025-26/schedule" },

  { schoolId:"cbc", platform:NAIA_PRESTO, host:"naiastats.prestosports.com", parserType:null, status:PRESTO_BLOCKED, serverFetchable:false, conferenceKey:"American_Midwest", fallbackHost:"cbcmustangs.com", evidencePath:"/sports/mbkb/2025-26/conf/American_Midwest/schedule" },
  { schoolId:"crowleys-ridge", platform:NAIA_PRESTO, host:"naiastats.prestosports.com", parserType:null, status:PRESTO_BLOCKED, serverFetchable:false, conferenceKey:"American_Midwest", fallbackHost:"crcpioneers.com", evidencePath:"/sports/wbkb/2025-26" },
  { schoolId:"williams-baptist", platform:NAIA_PRESTO, host:"naiastats.prestosports.com", parserType:null, status:PRESTO_BLOCKED, serverFetchable:false, conferenceKey:"American_Midwest", fallbackHost:"williamsbu.edu", evidencePath:"/sports/bsb/2025-26/conf/americanmidwest/schedule" },
  { schoolId:"philander-smith", platform:NAIA_PRESTO, host:"naiastats.prestosports.com", parserType:null, status:PRESTO_BLOCKED, serverFetchable:false, conferenceKey:"hbcuathleticconference", fallbackHost:"philander.edu", evidencePath:"/sports/bsb/2025-26/conf/hbcuathleticconference/schedule" },

  { schoolId:"asu-mid-south", platform:NJCAA_PRESTO, host:"njcaastats.prestosports.com", parserType:null, status:PRESTO_BLOCKED, serverFetchable:false, fallbackHost:"events.asumidsouth.edu" },
  { schoolId:"asu-mountain-home", platform:NJCAA_PRESTO, host:"njcaastats.prestosports.com", parserType:null, status:"no-supported-teams", serverFetchable:false },
  { schoolId:"asu-newport", platform:NJCAA_PRESTO, host:"njcaastats.prestosports.com", parserType:null, status:PRESTO_BLOCKED, serverFetchable:false, fallbackHost:"asund.edu" },
  { schoolId:"asu-three-rivers", platform:NJCAA_PRESTO, host:"njcaastats.prestosports.com", parserType:null, status:"no-supported-teams", serverFetchable:false },
  { schoolId:"national-park", platform:NJCAA_PRESTO, host:"njcaastats.prestosports.com", parserType:null, status:PRESTO_BLOCKED, serverFetchable:false, fallbackHost:"np.edu" },
  { schoolId:"north-arkansas", platform:NJCAA_PRESTO, host:"njcaastats.prestosports.com", parserType:null, status:PRESTO_BLOCKED, serverFetchable:false, fallbackHost:"northark.edu" },
  { schoolId:"nwacc", platform:NJCAA_PRESTO, host:"njcaastats.prestosports.com", parserType:null, status:PRESTO_BLOCKED, serverFetchable:false, fallbackHost:"nwacc.edu" },
  { schoolId:"shorter", platform:NJCAA_PRESTO, host:"njcaastats.prestosports.com", parserType:null, status:PRESTO_BLOCKED, serverFetchable:false, fallbackHost:"shortercollege.edu" },
  { schoolId:"south-arkansas", platform:NJCAA_PRESTO, host:"njcaastats.prestosports.com", parserType:null, status:PRESTO_BLOCKED, serverFetchable:false, fallbackHost:"southark.edu" },
  { schoolId:"seark", platform:NJCAA_PRESTO, host:"njcaastats.prestosports.com", parserType:null, status:PRESTO_BLOCKED, serverFetchable:false, fallbackHost:"seark.edu" },
  { schoolId:"sau-tech", platform:NJCAA_PRESTO, host:"njcaastats.prestosports.com", parserType:null, status:PRESTO_BLOCKED, serverFetchable:false, fallbackHost:"sautrockets.com" },
  { schoolId:"ua-rich-mountain", platform:NJCAA_PRESTO, host:"njcaastats.prestosports.com", parserType:null, status:PRESTO_BLOCKED, serverFetchable:false, fallbackHost:"uarichmountain.edu" },
  { schoolId:"ua-cossatot", platform:NJCAA_PRESTO, host:"njcaastats.prestosports.com", parserType:null, status:PRESTO_BLOCKED, serverFetchable:false, fallbackHost:"cccua.edu" }
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

function parserReadyUrl(platform, team, season) {
  if (platform.parserType === "sidearm") return sidearmScheduleUrl(platform, team, season);
  if (platform.parserType === "arkansas-razorbacks") return arkansasRazorbackScheduleUrl(team);
  return null;
}

export function collegeSourceAuditSummary() {
  const summary = {
    schools: COLLEGE_SOURCE_PLATFORMS.length,
    parserReadySchools:0, parserReadyTeams:0,
    blockedAuthoritySchools:0, blockedAuthorityTeams:0,
    noSupportedTeamSchools:0,
    pendingTeams:0, totalTeams:0
  };

  for (const school of ARKANSAS_COLLEGE_TEAM_INVENTORY) {
    const platform = bySchool.get(school.schoolId);
    if (!platform) continue;
    const n = school.teams.length;
    if (platform.status === "parser-ready") {
      summary.parserReadySchools += 1; summary.parserReadyTeams += n;
    } else if (platform.status === PRESTO_BLOCKED) {
      summary.blockedAuthoritySchools += 1; summary.blockedAuthorityTeams += n;
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
    if (platform?.status !== "parser-ready" || platform.serverFetchable !== true) continue;
    for (const team of school.teams) {
      const sourceUrl = parserReadyUrl(platform, team, season);
      if (!sourceUrl) throw new Error(`No parser-ready URL for ${school.schoolId}:${team.sport}:${team.gender}`);
      candidates.push({
        schoolId: school.schoolId,
        sport: team.sport,
        gender: team.gender,
        season,
        sourceUrl,
        sourceType: "official-athletics",
        parserType: platform.parserType,
        certificationState: "parser-ready-source-pending-live-proof"
      });
    }
  }
  return candidates;
}

export function blockedPrestoAuthorityTargets() {
  const targets = [];
  for (const school of ARKANSAS_COLLEGE_TEAM_INVENTORY) {
    const platform = bySchool.get(school.schoolId);
    if (platform?.status !== PRESTO_BLOCKED) continue;
    for (const team of school.teams) targets.push({
      schoolId:school.schoolId,
      sport:team.sport,
      gender:team.gender,
      authorityHost:platform.host,
      fallbackHost:platform.fallbackHost || null,
      authorityPlatform:platform.platform,
      serverFetchable:false,
      certificationState:"authority-confirmed-fallback-pending"
    });
  }
  return targets;
}

export function blockedPrestoAuthoritySummary() {
  const targets = blockedPrestoAuthorityTargets();
  return {
    schools:new Set(targets.map(row => row.schoolId)).size,
    teams:targets.length,
    naiaTeams:targets.filter(row => row.authorityPlatform === NAIA_PRESTO).length,
    njcaaTeams:targets.filter(row => row.authorityPlatform === NJCAA_PRESTO).length,
    directPrestoTeams:targets.filter(row => row.authorityPlatform === PRESTO).length
  };
}
