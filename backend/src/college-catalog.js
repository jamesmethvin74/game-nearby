import { ARKANSAS_COLLEGE_TEAM_INVENTORY } from "./college-team-inventory.js";
import { arkansasCityCentroid } from "./college-city-centroids.js";

const VERIFIED_AT = "2026-09-02T00:00:00.000Z";
const LOCATION_SOURCE = "us-census-gazetteer-city-centroid-2024";

// Stable catalog metadata already used by the LocalBleachersAR Teams picker.
// Keep provider/source wiring separate: M3 first establishes the exact local
// college school/team denominator before schedule collectors are certified.
export const ARKANSAS_COLLEGE_SCHOOL_METADATA = [
  { id:"uark", city:"Fayetteville", mascot:"Razorbacks" },
  { id:"arkansas-state", city:"Jonesboro", mascot:"Red Wolves" },
  { id:"uapb", city:"Pine Bluff", mascot:"Golden Lions" },
  { id:"uca", city:"Conway", mascot:"Bears / Sugar Bears" },
  { id:"little-rock", city:"Little Rock", mascot:"Trojans" },
  { id:"arkansas-tech", city:"Russellville", mascot:"Wonder Boys / Golden Suns" },
  { id:"uafs", city:"Fort Smith", mascot:"Lions" },
  { id:"uam", city:"Monticello", mascot:"Boll Weevils / Cotton Blossoms" },
  { id:"harding", city:"Searcy", mascot:"Bisons" },
  { id:"henderson-state", city:"Arkadelphia", mascot:"Reddies" },
  { id:"ouachita-baptist", city:"Arkadelphia", mascot:"Tigers" },
  { id:"southern-arkansas", city:"Magnolia", mascot:"Muleriders" },
  { id:"hendrix", city:"Conway", mascot:"Warriors" },
  { id:"lyon", city:"Batesville", mascot:"Scots" },
  { id:"ozarks", city:"Clarksville", mascot:"Eagles" },
  { id:"arkansas-baptist", city:"Little Rock", mascot:"Buffaloes" },
  { id:"cbc", city:"Conway", mascot:"Mustangs" },
  { id:"crowleys-ridge", city:"Paragould", mascot:"Pioneers" },
  { id:"john-brown", city:"Siloam Springs", mascot:"Golden Eagles" },
  { id:"philander-smith", city:"Little Rock", mascot:"Panthers" },
  { id:"williams-baptist", city:"Walnut Ridge", mascot:"Eagles" },
  { id:"asu-mid-south", city:"West Memphis", mascot:"Greyhounds" },
  { id:"asu-mountain-home", city:"Mountain Home", mascot:"Trailblazers" },
  { id:"asu-newport", city:"Newport", mascot:"Aviators" },
  { id:"asu-three-rivers", city:"Malvern", mascot:"Eagles" },
  { id:"national-park", city:"Hot Springs", mascot:"Nighthawks" },
  { id:"north-arkansas", city:"Harrison", mascot:"Pioneers" },
  { id:"nwacc", city:"Bentonville", mascot:"Eagles" },
  { id:"shorter", city:"North Little Rock", mascot:"Bulldogs" },
  { id:"south-arkansas", city:"El Dorado", mascot:"Stars" },
  { id:"seark", city:"Pine Bluff", mascot:"Sharks" },
  { id:"sau-tech", city:"Camden", mascot:"Rockets" },
  { id:"ua-rich-mountain", city:"Mena", mascot:"Bucks" },
  { id:"ua-cossatot", city:"De Queen", mascot:"Colts" },
  { id:"champion-christian", city:"Hot Springs", mascot:"Tigers" },
  { id:"ecclesia", city:"Springdale", mascot:"Royals" }
];

const metadataById = new Map(ARKANSAS_COLLEGE_SCHOOL_METADATA.map(row => [row.id, row]));

export function collegeCatalogSeed(season = "2026") {
  const schools = ARKANSAS_COLLEGE_TEAM_INVENTORY.map(school => {
    const metadata = metadataById.get(school.schoolId);
    if (!metadata) throw new Error(`Missing college catalog metadata for ${school.schoolId}`);
    const centroid = arkansasCityCentroid(metadata.city);
    if (!centroid) throw new Error(`Missing Arkansas city centroid for ${school.schoolId}:${metadata.city}`);
    return {
      id: school.schoolId,
      name: school.schoolName,
      city: metadata.city,
      state: "AR",
      level: "college",
      mascot: metadata.mascot,
      latitude: centroid.latitude,
      longitude: centroid.longitude,
      locationSource: LOCATION_SOURCE,
      locationUpdatedAt: VERIFIED_AT,
      catalogScope: "local",
      membershipSource: school.verificationStatus === "verified" ? "college-inventory-verified" : "college-inventory-provisional",
      membershipVerifiedAt: school.verificationStatus === "verified" ? VERIFIED_AT : null,
      verificationStatus: school.verificationStatus
    };
  });

  const teams = ARKANSAS_COLLEGE_TEAM_INVENTORY.flatMap(school => school.teams.map(team => ({
    id: `${school.schoolId}-${team.sport}-${team.gender}-${season}`,
    schoolId: school.schoolId,
    sport: team.sport,
    gender: team.gender,
    season,
    active: 1
  })));

  return { schools, teams };
}

export const COLLEGE_SCHOOL_INSERT_SQL = `
  INSERT OR IGNORE INTO schools
    (id,name,city,state,level,mascot,latitude,longitude,location_source,location_updated_at,
     catalog_scope,membership_source,membership_verified_at)
  SELECT
    json_extract(value,'$.id'),
    json_extract(value,'$.name'),
    json_extract(value,'$.city'),
    json_extract(value,'$.state'),
    json_extract(value,'$.level'),
    json_extract(value,'$.mascot'),
    CAST(json_extract(value,'$.latitude') AS REAL),
    CAST(json_extract(value,'$.longitude') AS REAL),
    json_extract(value,'$.locationSource'),
    json_extract(value,'$.locationUpdatedAt'),
    json_extract(value,'$.catalogScope'),
    json_extract(value,'$.membershipSource'),
    json_extract(value,'$.membershipVerifiedAt')
  FROM json_each(?)
`;

export const COLLEGE_TEAM_INSERT_SQL = `
  INSERT OR IGNORE INTO teams
    (id,school_id,sport,gender,season,active)
  SELECT
    json_extract(value,'$.id'),
    json_extract(value,'$.schoolId'),
    json_extract(value,'$.sport'),
    json_extract(value,'$.gender'),
    json_extract(value,'$.season'),
    json_extract(value,'$.active')
  FROM json_each(?)
`;

export async function syncArkansasCollegeCatalog(env, { season = "2026" } = {}) {
  const seed = collegeCatalogSeed(season);
  const statements = [
    env.DB.prepare(COLLEGE_SCHOOL_INSERT_SQL).bind(JSON.stringify(seed.schools)),
    env.DB.prepare(COLLEGE_TEAM_INSERT_SQL).bind(JSON.stringify(seed.teams))
  ];
  const results = await env.DB.batch(statements);
  const meta = results.map(result => result?.meta || {});
  return {
    status: "SUCCESS",
    season,
    targetSchools: seed.schools.length,
    targetTeams: seed.teams.length,
    verifiedSchools: seed.schools.filter(row => row.verificationStatus === "verified").length,
    provisionalSchools: seed.schools.filter(row => row.verificationStatus !== "verified").length,
    rowsRead: meta.reduce((sum, row) => sum + Number(row.rows_read || 0), 0),
    rowsWritten: meta.reduce((sum, row) => sum + Number(row.rows_written || 0), 0)
  };
}
