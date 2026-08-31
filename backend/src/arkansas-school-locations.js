import { normalizeSchoolAlias } from "./schedule-authority-core.js";

const GIS_ROOT="https://gis.arkansas.gov/arcgis/rest/services/FEATURESERVICES/Structure/FeatureServer";
const SYNC_ID="arkansas-gis:school-points:v1";
const PROVIDER="arkansas-gis-office";
const LAYERS=[
  {id:39,source:"arkansas-gis-public"},
  {id:37,source:"arkansas-gis-private"}
];

function clean(value){return String(value??"").replace(/\s+/g," ").trim();}
function validCoordinate(latitude,longitude){
  return Number.isFinite(latitude) && Number.isFinite(longitude)
    && latitude>=32.5 && latitude<=37.5 && longitude>=-95.0 && longitude<=-89.0;
}

export function locationNameKey(value){
  return normalizeSchoolAlias(value);
}

export function relaxedLocationNameKey(value){
  const withoutParenthetical=clean(value).replace(/\([^)]*\)/g," ");
  return normalizeSchoolAlias(withoutParenthetical)
    .replace(/\b(?:academy|public|charter|preparatory|prep|senior|sr|junior|jr)\b/g," ")
    .replace(/\s+/g," ")
    .trim();
}

function normalizeFeature(feature,source){
  const attributes=feature?.attributes||{};
  const longitude=Number(feature?.geometry?.x);
  const latitude=Number(feature?.geometry?.y);
  const name=clean(attributes.name);
  if (!name || !validCoordinate(latitude,longitude)) return null;
  return {
    source,
    source_record_id:String(attributes.objectid??attributes.globalid??""),
    name,
    address:clean(attributes.address),
    city:clean(attributes.city),
    postal_code:clean(attributes.zipcode),
    lea:clean(attributes.lea),
    latitude,
    longitude,
    exact_key:locationNameKey(name),
    relaxed_key:relaxedLocationNameKey(name)
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
    const response=await fetchFn(url.toString(),{headers:{"accept":"application/json","user-agent":"LocalBleachersAR-location-enrichment/1.0"}});
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

function cityKey(value){return normalizeSchoolAlias(value);}

function uniqueByCity(candidates,city){
  const key=cityKey(city);
  if (!key) return null;
  const matches=candidates.filter(candidate=>cityKey(candidate.city)===key);
  return matches.length===1?matches[0]:null;
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

    if (exact && targetExactCounts.get(exact)===1) {
      const candidates=exactIndex.get(exact)||[];
      if (candidates.length===1) { candidate=candidates[0]; matchType="exact"; }
      else if (candidates.length>1) {
        const byCity=uniqueByCity(candidates,school.city);
        if (byCity) { candidate=byCity; matchType="exact-city"; }
      }
    }

    if (!candidate && relaxed && targetRelaxedCounts.get(relaxed)===1) {
      const candidates=relaxedIndex.get(relaxed)||[];
      if (candidates.length===1) { candidate=candidates[0]; matchType="relaxed-unique"; }
      else if (candidates.length>1) {
        const byCity=uniqueByCity(candidates,school.city);
        if (byCity) { candidate=byCity; matchType="relaxed-city"; }
      }
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

    const exactCandidates=exactIndex.get(exact)||[];
    const relaxedCandidates=relaxedIndex.get(relaxed)||[];
    const duplicateTarget=(exact && targetExactCounts.get(exact)>1) || (relaxed && targetRelaxedCounts.get(relaxed)>1);
    const candidateCount=Math.max(exactCandidates.length,relaxedCandidates.length);
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

export async function syncArkansasSchoolLocations(env,{
  fetchFn=fetch,now=new Date(),force=false,maxAgeDays=7,minimumMatchRatio=0.7,chunkSize=400
}={}){
  if (!force && await locationFresh(env,now,maxAgeDays)) return {status:"SKIPPED",reason:"locations_fresh"};
  const checkedAt=now.toISOString();
  try {
    const {results:schools}=await env.DB.prepare(`
      SELECT DISTINCT s.id,s.name,s.city,s.latitude,s.longitude
      FROM schools s JOIN teams t ON t.school_id=s.id
      WHERE s.level='high-school' AND t.sport='volleyball' AND t.gender='girls' AND t.season='2026' AND t.active=1
      ORDER BY s.name,s.id`).all();
    if (!schools.length) throw new Error("No statewide varsity volleyball schools available for location enrichment");

    const gis=await fetchArkansasSchoolLocationFeatures({fetchFn});
    const result=matchArkansasSchoolLocations(schools,gis.features);
    const ratio=result.matched.length/schools.length;
    if (ratio<minimumMatchRatio) throw new Error(`Arkansas GIS school match ratio ${(ratio*100).toFixed(1)}% is below ${(minimumMatchRatio*100).toFixed(1)}% safety threshold`);

    await applyMatches(env,result.matched,checkedAt,chunkSize);
    const details={
      matchRatio:Number(ratio.toFixed(4)),
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
