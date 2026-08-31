import { normalizeSchoolAlias } from "./schedule-authority-core.js";

const GIS_ROOT="https://gis.arkansas.gov/arcgis/rest/services/FEATURESERVICES/Structure/FeatureServer";
const SYNC_ID="arkansas-gis:school-points:v1";
const PROVIDER="arkansas-gis-office";
const LAYERS=[
  {id:39,source:"arkansas-gis-public"},
  {id:37,source:"arkansas-gis-private"}
];

// These are documented current/legacy Arkansas school-name bridges, not fuzzy matches.
// Every row names one specific current GIS school and city. Duplicate/uncertain identities
// (Benton duplicate orgs, Mansfield transition, Ozark duplicates, Trinity, Westside, etc.)
// intentionally remain quarantined.
const OFFICIAL_ARKANSAS_ALIASES=[
  {input:"Batesville High School",official:"Batesville High School Charter",city:"Batesville"},
  {input:"Central West Helena",official:"Central High School",city:"West Helena"},
  {input:"HARMONY GROVE HIGH SCHOOL - HASKELL",official:"Harmony Grove High School",city:"Benton"},
  {input:"Harmony Grove High School (Camden)",official:"Harmony Grove High School",city:"Camden"},
  {input:"IZARD CO. CONS. HIGH SCHOOL",official:"Izard County Consolidated High School",city:"Brockwell"},
  {input:"Lakeside High School (Hot Springs)",official:"Lakeside High School",city:"Hot Springs"},
  {input:"LEE COUNTY HIGH SCHOOL",official:"Lee High School",city:"Marianna"},
  {input:"Little Rock Central High School",official:"Central High School",city:"Little Rock"},
  {input:"Morrilton Sr. High School (7-12 athletics)",official:"Morrilton Senior High School",city:"Morrilton"},
  {input:"MOUNTAIN HOME HIGH SCHOOL",official:"Mountain Home High School (Career Academies)",city:"Mountain Home"},
  {input:"NEWPORT HIGH SCHOOL",official:"The Academies At Newport High School",city:"Newport"},
  {input:"Rivercrest High School",official:"Academies At Rivercrest High School",city:"Wilson"},
  {input:"West Memphis High School",official:"The Academies Of West Memphis Charter School",city:"West Memphis"}
];

function clean(value){return String(value??"").replace(/\s+/g," ").trim();}
function validCoordinate(latitude,longitude){
  return Number.isFinite(latitude) && Number.isFinite(longitude)
    && latitude>=32.5 && latitude<=37.5 && longitude>=-95.0 && longitude<=-89.0;
}

function normalizedNameInput(value){
  return clean(value)
    .replace(/[–—]/g,"-")
    .replace(/\bH\s*S\b/gi,"High School")
    .replace(/\bschools\b/gi,"school");
}

function strictSchoolNameKey(value){
  return normalizedNameInput(value).toLowerCase().replace(/[^a-z0-9]+/g," ").replace(/\s+/g," ").trim();
}

export function locationNameKey(value){
  return normalizeSchoolAlias(normalizedNameInput(value));
}

function stripInstitutionalNoise(value){
  return locationNameKey(value)
    .replace(/\bthe academies (?:at|of)\b/g," ")
    .replace(/\bacademies of arkansas\b/g," ")
    .replace(/\bcareer and collegiate preparatory\b/g," ")
    .replace(/\bconversion charter\b/g," ")
    .replace(/\b(?:7 12|9 12|10 12|6 12) athletics\b/g," ")
    .replace(/\b(?:7 12|9 12|10 12|6 12)\b/g," ")
    .replace(/\b(?:academy|academies|public|charter|preparatory|prep|senior|sr|junior|jr|athletics|campus|consolidated|christian)\b/g," ")
    .replace(/\b(?:the|at|of)\b/g," ")
    .replace(/\s+/g," ")
    .trim();
}

function locationQualifier(value){
  const text=normalizedNameInput(value);
  const parenthetical=[...text.matchAll(/\(([^)]+)\)/g)].map(match=>clean(match[1])).filter(Boolean);
  const dash=text.match(/\s+-\s+([^\-]+)$/);
  const hints=[...parenthetical,dash?.[1]].filter(Boolean)
    .filter(hint=>!/^\d+\s*-?\s*\d*\s*(?:athletics)?$/i.test(hint));
  return hints.length?hints.at(-1):"";
}

function coreNameWithoutQualifier(value){
  let text=normalizedNameInput(value).replace(/\([^)]*\)/g," ");
  text=text.replace(/\s+-\s+[^\-]+$/," ");
  return stripInstitutionalNoise(text);
}

export function relaxedLocationNameKey(value){
  return coreNameWithoutQualifier(value);
}

function cityKey(value){return normalizeSchoolAlias(value);}
function removeCityFromCore(core,city){
  const cityNormalized=cityKey(city);
  if (!core || !cityNormalized) return core;
  const cityTokens=cityNormalized.split(" ").filter(Boolean);
  let tokens=core.split(" ").filter(Boolean);
  if (cityTokens.every(token=>tokens.includes(token))) {
    const remaining=[...tokens];
    for (const token of cityTokens) {
      const index=remaining.indexOf(token);
      if (index>=0) remaining.splice(index,1);
    }
    return remaining.join(" ");
  }
  return core;
}

function normalizeFeature(feature,source){
  const attributes=feature?.attributes||{};
  const longitude=Number(feature?.geometry?.x);
  const latitude=Number(feature?.geometry?.y);
  const name=clean(attributes.name);
  const city=clean(attributes.city);
  if (!name || !validCoordinate(latitude,longitude)) return null;
  const structural=coreNameWithoutQualifier(name);
  return {
    source,
    source_record_id:String(attributes.objectid??attributes.globalid??""),
    name,
    address:clean(attributes.address),
    city,
    postal_code:clean(attributes.zipcode),
    lea:clean(attributes.lea),
    latitude,
    longitude,
    exact_key:locationNameKey(name),
    strict_key:strictSchoolNameKey(name),
    relaxed_key:relaxedLocationNameKey(name),
    structural_key:structural,
    structural_without_city:removeCityFromCore(structural,city)
  };
}

async function fetchLayer(layer,{fetchFn=fetch,pageSize=500}={}){
  const records=[];
  for (let offset=0;;offset+=pageSize) {
    const url=new URL(`${GIS_ROOT}/${layer.id}/query`);
    url.searchParams.set("where","1=1");
    url.searchParams.set("outFields","objectid,globalid,lea,name,address,city,zipcode");
    url.searchParams.set("returnGeometry","true");
    url.searchParams.set("outSR","4326");
    url.searchParams.set("orderByFields","objectid");
    url.searchParams.set("resultOffset",String(offset));
    url.searchParams.set("resultRecordCount",String(pageSize));
    url.searchParams.set("f","json");
    const response=await fetchFn(url.toString(),{headers:{"accept":"application/json","user-agent":"LocalBleachersAR-location-enrichment/3.0"}});
    if (!response.ok) throw new Error(`Arkansas GIS layer ${layer.id} returned HTTP ${response.status}`);
    const payload=await response.json();
    if (payload?.error) throw new Error(`Arkansas GIS layer ${layer.id} error: ${payload.error.message||"unknown"}`);
    const features=Array.isArray(payload?.features)?payload.features:[];
    for (const feature of features) {
      const normalized=normalizeFeature(feature,layer.source);
      if (normalized) records.push(normalized);
    }
    if (!features.length || (payload?.exceededTransferLimit!==true && features.length<pageSize)) break;
    if (offset>10000) throw new Error(`Arkansas GIS layer ${layer.id} pagination exceeded safety cap`);
  }
  return records;
}

export async function fetchArkansasSchoolLocationFeatures({fetchFn=fetch,pageSize=500}={}){
  const groups=await Promise.all(LAYERS.map(layer=>fetchLayer(layer,{fetchFn,pageSize})));
  return {
    publicFeatures:groups[0],
    privateFeatures:groups[1],
    features:[...groups[0],...groups[1]]
  };
}

function indexBy(items,keyName){
  const map=new Map();
  for (const item of items) {
    const key=item[keyName];
    if (!key) continue;
    const values=map.get(key)||[];
    values.push(item);
    map.set(key,values);
  }
  return map;
}

function uniquePhysicalCandidates(candidates){
  const map=new Map();
  for (const candidate of candidates) {
    const key=[candidate.source,cityKey(candidate.city),candidate.latitude.toFixed(5),candidate.longitude.toFixed(5),candidate.strict_key||candidate.exact_key].join("|");
    if (!map.has(key)) map.set(key,candidate);
  }
  return [...map.values()];
}

function uniqueByCity(candidates,city){
  const key=cityKey(city);
  if (!key) return null;
  const matches=uniquePhysicalCandidates(candidates.filter(candidate=>cityKey(candidate.city)===key));
  return matches.length===1?matches[0]:null;
}

function cityAppearsInSchoolName(schoolName,city){
  const target=locationNameKey(schoolName);
  const cityNormalized=cityKey(city);
  if (!target || !cityNormalized) return false;
  const targetTokens=new Set(target.split(" "));
  return cityNormalized.split(" ").every(token=>targetTokens.has(token));
}

function officialAliasCandidate(school,features){
  const inputKey=strictSchoolNameKey(school.name);
  const alias=OFFICIAL_ARKANSAS_ALIASES.find(row=>strictSchoolNameKey(row.input)===inputKey);
  if (!alias) return null;
  const officialKey=strictSchoolNameKey(alias.official);
  const city=cityKey(alias.city);
  const candidates=uniquePhysicalCandidates(features.filter(feature=>feature.strict_key===officialKey && cityKey(feature.city)===city));
  return candidates.length===1?{candidate:candidates[0],type:"official-alias-city"}:null;
}

function deterministicStructuralCandidate(school,features,targetCore){
  if (!targetCore) return null;
  const qualifier=locationQualifier(school.name);
  const qualifierKey=cityKey(qualifier);
  let candidates=uniquePhysicalCandidates(features.filter(feature=>
    feature.structural_key===targetCore || feature.structural_without_city===targetCore
  ));
  if (!candidates.length) return null;

  if (qualifierKey) {
    const byQualifier=uniqueByCity(candidates,qualifier);
    if (byQualifier) return {candidate:byQualifier,type:"structural-qualifier-city"};
  }
  const byStoredCity=uniqueByCity(candidates,school.city);
  if (byStoredCity) return {candidate:byStoredCity,type:"structural-city"};

  const embedded=candidates.filter(candidate=>cityAppearsInSchoolName(school.name,candidate.city));
  if (uniquePhysicalCandidates(embedded).length===1) return {candidate:uniquePhysicalCandidates(embedded)[0],type:"structural-embedded-city"};

  if (candidates.length===1) return {candidate:candidates[0],type:"structural-unique"};
  return null;
}

export function matchArkansasSchoolLocations(schools,features){
  const exactIndex=indexBy(features,"exact_key");
  const relaxedIndex=indexBy(features,"relaxed_key");
  const targetExactCounts=new Map();
  const targetRelaxedCounts=new Map();
  for (const school of schools) {
    const exact=locationNameKey(school.name);
    const relaxed=relaxedLocationNameKey(school.name);
    if (exact) targetExactCounts.set(exact,(targetExactCounts.get(exact)||0)+1);
    if (relaxed) targetRelaxedCounts.set(relaxed,(targetRelaxedCounts.get(relaxed)||0)+1);
  }

  const matched=[];
  const unresolved=[];
  const ambiguous=[];
  for (const school of schools) {
    const exact=locationNameKey(school.name);
    const relaxed=relaxedLocationNameKey(school.name);
    let candidate=null;
    let matchType=null;

    const official=officialAliasCandidate(school,features);
    if (official) { candidate=official.candidate; matchType=official.type; }

    if (!candidate && exact && targetExactCounts.get(exact)===1) {
      const candidates=uniquePhysicalCandidates(exactIndex.get(exact)||[]);
      if (candidates.length===1) { candidate=candidates[0]; matchType="exact"; }
      else if (candidates.length>1) {
        const qualifier=locationQualifier(school.name);
        const byQualifier=uniqueByCity(candidates,qualifier);
        const byCity=byQualifier||uniqueByCity(candidates,school.city);
        const embedded=candidates.filter(item=>cityAppearsInSchoolName(school.name,item.city));
        const embeddedUnique=uniquePhysicalCandidates(embedded);
        const chosen=byCity||(embeddedUnique.length===1?embeddedUnique[0]:null);
        if (chosen) { candidate=chosen; matchType=byQualifier?"exact-qualifier-city":byCity?"exact-city":"exact-embedded-city"; }
      }
    }

    if (!candidate && relaxed && targetRelaxedCounts.get(relaxed)===1) {
      const candidates=uniquePhysicalCandidates(relaxedIndex.get(relaxed)||[]);
      if (candidates.length===1) { candidate=candidates[0]; matchType="relaxed-unique"; }
      else if (candidates.length>1) {
        const qualifier=locationQualifier(school.name);
        const byQualifier=uniqueByCity(candidates,qualifier);
        const byCity=byQualifier||uniqueByCity(candidates,school.city);
        const embedded=candidates.filter(item=>cityAppearsInSchoolName(school.name,item.city));
        const embeddedUnique=uniquePhysicalCandidates(embedded);
        const chosen=byCity||(embeddedUnique.length===1?embeddedUnique[0]:null);
        if (chosen) { candidate=chosen; matchType=byQualifier?"relaxed-qualifier-city":byCity?"relaxed-city":"relaxed-embedded-city"; }
      }
    }

    // Explicit city qualifiers are safe even when another DragonFly participant happens
    // to normalize to the same core name; duplicate unqualified names remain quarantined.
    if (!candidate && relaxed && (targetRelaxedCounts.get(relaxed)===1 || locationQualifier(school.name))) {
      const structural=deterministicStructuralCandidate(school,features,relaxed);
      if (structural) { candidate=structural.candidate; matchType=structural.type; }
    }

    if (candidate) {
      matched.push({
        school_id:school.id,
        school_name:school.name,
        matched_name:candidate.name,
        source:candidate.source,
        source_record_id:candidate.source_record_id,
        address:candidate.address||null,
        city:candidate.city||null,
        postal_code:candidate.postal_code||null,
        latitude:candidate.latitude,
        longitude:candidate.longitude,
        match_type:matchType
      });
      continue;
    }

    const exactCandidates=uniquePhysicalCandidates(exactIndex.get(exact)||[]);
    const relaxedCandidates=uniquePhysicalCandidates(relaxedIndex.get(relaxed)||[]);
    const structuralCandidates=relaxed?uniquePhysicalCandidates(features.filter(feature=>feature.structural_key===relaxed||feature.structural_without_city===relaxed)):[];
    const duplicateTarget=(exact && targetExactCounts.get(exact)>1) || (relaxed && targetRelaxedCounts.get(relaxed)>1);
    const candidateCount=Math.max(exactCandidates.length,relaxedCandidates.length,structuralCandidates.length);
    const detail={school_id:school.id,school_name:school.name,city:school.city||null,candidate_count:candidateCount};
    if (duplicateTarget || candidateCount>1) ambiguous.push({...detail,reason:duplicateTarget?"duplicate-local-name":"multiple-gis-candidates"});
    else unresolved.push({...detail,reason:"no-safe-gis-match"});
  }
  return {matched,unresolved,ambiguous};
}

async function locationFresh(env,now,maxAgeDays){
  const row=await env.DB.prepare("SELECT last_successful_sync_at FROM school_location_sync_state WHERE id=?").bind(SYNC_ID).first();
  const last=row?.last_successful_sync_at?Date.parse(row.last_successful_sync_at):NaN;
  return Number.isFinite(last) && now.getTime()-last < maxAgeDays*24*60*60*1000;
}

async function applyMatches(env,matches,checkedAt,chunkSize=400){
  const sql=`WITH input AS (
      SELECT
        json_extract(value,'$.school_id') AS school_id,
        json_extract(value,'$.matched_name') AS matched_name,
        json_extract(value,'$.source') AS source,
        json_extract(value,'$.address') AS address,
        json_extract(value,'$.city') AS city,
        json_extract(value,'$.postal_code') AS postal_code,
        json_extract(value,'$.latitude') AS latitude,
        json_extract(value,'$.longitude') AS longitude
      FROM json_each(?)
    )
    UPDATE schools SET
      city=CASE WHEN trim(COALESCE(city,''))='' THEN COALESCE((SELECT city FROM input WHERE input.school_id=schools.id),city) ELSE city END,
      address=COALESCE((SELECT address FROM input WHERE input.school_id=schools.id),address),
      postal_code=COALESCE((SELECT postal_code FROM input WHERE input.school_id=schools.id),postal_code),
      latitude=COALESCE((SELECT latitude FROM input WHERE input.school_id=schools.id),latitude),
      longitude=COALESCE((SELECT longitude FROM input WHERE input.school_id=schools.id),longitude),
      location_source=(SELECT source FROM input WHERE input.school_id=schools.id),
      location_matched_name=(SELECT matched_name FROM input WHERE input.school_id=schools.id),
      location_updated_at=?,updated_at=?
    WHERE id IN (SELECT school_id FROM input)`;
  for (let i=0;i<matches.length;i+=chunkSize) {
    await env.DB.prepare(sql).bind(JSON.stringify(matches.slice(i,i+chunkSize)),checkedAt,checkedAt).run();
  }
}

async function applyArkansasCatalogScope(env,result,checkedAt){
  const localIds=result.matched.map(row=>row.school_id);
  const opponentOnlyIds=[...result.unresolved,...result.ambiguous].map(row=>row.school_id);

  const updateSchoolScope=async(ids,scope)=>{
    if (!ids.length) return;
    if (scope==="local") {
      await env.DB.prepare(`WITH input AS (SELECT value AS school_id FROM json_each(?))
        UPDATE schools SET catalog_scope='local',state='AR',level='high-school',membership_source='arkansas-gis',membership_verified_at=?,updated_at=?
        WHERE id IN (SELECT school_id FROM input)
          AND EXISTS (SELECT 1 FROM teams t JOIN sources src ON src.team_id=t.id WHERE t.school_id=schools.id AND src.collection_mode='statewide')`)
        .bind(JSON.stringify(ids),checkedAt,checkedAt).run();
    } else {
      await env.DB.prepare(`WITH input AS (SELECT value AS school_id FROM json_each(?))
        UPDATE schools SET catalog_scope='opponent-only',state=CASE WHEN id LIKE 'df-%' THEN '' ELSE state END,
          membership_source='dragonfly-unverified',membership_verified_at=NULL,updated_at=?
        WHERE id IN (SELECT school_id FROM input)
          AND EXISTS (SELECT 1 FROM teams t JOIN sources src ON src.team_id=t.id WHERE t.school_id=schools.id AND src.collection_mode='statewide')
          AND NOT EXISTS (SELECT 1 FROM teams t JOIN sources src ON src.team_id=t.id WHERE t.school_id=schools.id AND src.collection_mode='team')`)
        .bind(JSON.stringify(ids),checkedAt).run();
    }
  };

  const updateTeamActive=async(ids,active)=>{
    if (!ids.length) return;
    await env.DB.prepare(`WITH input AS (SELECT value AS school_id FROM json_each(?))
      UPDATE teams SET active=?,updated_at=?
      WHERE school_id IN (SELECT school_id FROM input)
        AND sport='volleyball' AND gender='girls' AND season='2026'
        AND EXISTS (SELECT 1 FROM sources src WHERE src.team_id=teams.id AND src.collection_mode='statewide')
        AND NOT EXISTS (SELECT 1 FROM sources src WHERE src.team_id=teams.id AND src.collection_mode='team')`)
      .bind(JSON.stringify(ids),active,checkedAt).run();
  };

  await updateSchoolScope(localIds,"local");
  await updateSchoolScope(opponentOnlyIds,"opponent-only");
  await updateTeamActive(localIds,1);
  await updateTeamActive(opponentOnlyIds,0);
}

export async function syncArkansasSchoolLocations(env,{
  fetchFn=fetch,now=new Date(),force=false,maxAgeDays=7,minimumMatchRatio=0.65,minimumMatchedSchools=170,chunkSize=400
}={}){
  if (!force && await locationFresh(env,now,maxAgeDays)) return {status:"SKIPPED",reason:"locations_fresh"};
  const checkedAt=now.toISOString();
  try {
    const {results:schools}=await env.DB.prepare(`
      SELECT DISTINCT s.id,s.name,s.city,s.latitude,s.longitude
      FROM schools s
      JOIN teams t ON t.school_id=s.id
      JOIN sources src ON src.team_id=t.id
      WHERE s.level='high-school' AND t.sport='volleyball' AND t.gender='girls' AND t.season='2026'
        AND (src.collection_mode='statewide' OR src.collection_mode='team')
      ORDER BY s.name,s.id`).all();
    if (!schools.length) throw new Error("No statewide varsity volleyball schools available for location enrichment");

    const gis=await fetchArkansasSchoolLocationFeatures({fetchFn});
    const result=matchArkansasSchoolLocations(schools,gis.features);
    const ratio=result.matched.length/schools.length;
    if (result.matched.length<minimumMatchedSchools || ratio<minimumMatchRatio) {
      throw new Error(`Arkansas GIS school coverage is suspicious: ${result.matched.length}/${schools.length} safe matches (${(ratio*100).toFixed(1)}%)`);
    }

    await applyMatches(env,result.matched,checkedAt,chunkSize);
    await applyArkansasCatalogScope(env,result,checkedAt);
    const details={
      matchRatio:Number(ratio.toFixed(4)),
      safeArkansasSchools:result.matched.length,
      opponentOnlyOrUnresolved:result.unresolved.length+result.ambiguous.length,
      unresolved:result.unresolved,
      ambiguous:result.ambiguous,
      sources:{public:"Arkansas GIS PUBLIC_SCHOOLS_DOE layer 39",private:"Arkansas GIS PRIVATE_SCHOOLS_DOE layer 37"}
    };
    await env.DB.prepare(`INSERT INTO school_location_sync_state
      (id,provider,last_checked_at,last_successful_sync_at,target_school_count,matched_school_count,unresolved_school_count,ambiguous_school_count,public_feature_count,private_feature_count,last_error,details_json,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,NULL,?,?)
      ON CONFLICT(id) DO UPDATE SET last_checked_at=excluded.last_checked_at,last_successful_sync_at=excluded.last_successful_sync_at,
        target_school_count=excluded.target_school_count,matched_school_count=excluded.matched_school_count,unresolved_school_count=excluded.unresolved_school_count,
        ambiguous_school_count=excluded.ambiguous_school_count,public_feature_count=excluded.public_feature_count,private_feature_count=excluded.private_feature_count,
        last_error=NULL,details_json=excluded.details_json,updated_at=excluded.updated_at`)
      .bind(SYNC_ID,PROVIDER,checkedAt,checkedAt,schools.length,result.matched.length,result.unresolved.length,result.ambiguous.length,
        gis.publicFeatures.length,gis.privateFeatures.length,JSON.stringify(details),checkedAt).run();
    return {status:"SUCCESS",targetSchools:schools.length,matchedSchools:result.matched.length,unresolvedSchools:result.unresolved.length,
      ambiguousSchools:result.ambiguous.length,matchRatio:ratio,publicFeatures:gis.publicFeatures.length,privateFeatures:gis.privateFeatures.length,
      unresolved:result.unresolved,ambiguous:result.ambiguous};
  } catch(error) {
    const message=String(error?.message||error).slice(0,1000);
    await env.DB.prepare(`INSERT INTO school_location_sync_state(id,provider,last_checked_at,last_error,updated_at)
      VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET last_checked_at=excluded.last_checked_at,last_error=excluded.last_error,updated_at=excluded.updated_at`)
      .bind(SYNC_ID,PROVIDER,checkedAt,message,checkedAt).run();
    throw error;
  }
}
