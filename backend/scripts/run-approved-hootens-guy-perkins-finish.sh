#!/usr/bin/env bash
set -euo pipefail

DB="localbleachersar-sports"
WORKER="localbleachersar-sports-api"
ALIAS="hootens-guy-perkins-finish"
API="https://${ALIAS}-${WORKER}.james-methvin74.workers.dev"
WRAPPER="src/_hootens-guy-perkins-finish.mjs"
RESULT_WRAPPER="src/_hootens-guy-perkins-proof.mjs"
TMPDIR="$(mktemp -d)"
TOKEN="$(node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))")"
TOKEN_ACTIVE=0

cleanup(){
  if [ "$TOKEN_ACTIVE" = "1" ]; then
    wrangler versions upload src/logo-bootstrap-worker.js --preview-alias "$ALIAS" --keep-vars >/dev/null 2>&1 || true
  fi
  rm -f "$WRAPPER" "$RESULT_WRAPPER"
  rm -rf "$TMPDIR"
}
trap cleanup EXIT

node --check src/hootens-resilient-results.js
node --check src/milestone2-scheduled-worker.js
node --test test/hootens-resilient-results.test.js test/hootens-statewide-results.test.js

# Put the permanent, non-reciprocal Hooten scheduler in production first.
wrangler deploy

node - "$TOKEN" > "$WRAPPER" <<'NODE'
const token=process.argv[2];
process.stdout.write(`import { rebuildTeamRecords } from "./record-rebuild.js";
const TOKEN=${JSON.stringify(token)};
const STATE_ID="hootens:football:current";
function ok(req){return req.headers.get("x-hootens-target-token")===TOKEN;}
function json(body,status=200){return Response.json(body,{status,headers:{"cache-control":"no-store"}});}
function reverse(v){return v==="home"?"away":v==="away"?"home":v==="neutral"?"neutral":"unknown";}
function resultCode(a,b){return a===b?"T":a>b?"W":"L";}
async function repair(env){
  const checkedAt=new Date().toISOString();
  const state=await env.DB.prepare("SELECT feed_url,details_json FROM statewide_collection_state WHERE id=?").bind(STATE_ID).first();
  let details={};try{details=JSON.parse(state?.details_json||"{}");}catch{}
  const scoreboardUrl=String(details.scoreboardUrl||state?.feed_url||"").trim();
  if(!scoreboardUrl) throw new Error("missing Hooten scoreboard URL");

  const sourceResult=await env.DB.prepare(\`
    SELECT g.*,t.school_id AS reporting_school_id,s.name AS reporting_school_name,
           os.id AS opponent_school_id,os.name AS opponent_school_name,
           ot.id AS opponent_team_id,ot.active AS opponent_team_active,ot.conference_id AS opponent_conference_id
    FROM games g
    JOIN teams t ON t.id=g.team_id
    JOIN schools s ON s.id=t.school_id
    JOIN schools os ON os.id=g.opponent_school_id
    LEFT JOIN sources src ON src.id=g.source_id
    LEFT JOIN teams ot ON ot.school_id=os.id AND ot.sport='football' AND ot.gender='boys' AND ot.season='2026'
    WHERE t.sport='football' AND t.gender='boys' AND t.season='2026'
      AND s.level='high-school' AND s.state='AR' AND s.catalog_scope='local'
      AND os.level='high-school' AND os.state='AR' AND os.catalog_scope='local'
      AND lower(replace(s.name,'-',' '))='blevins'
      AND lower(replace(os.name,'-',' '))='guy perkins'
      AND g.status='FINAL' AND g.team_score=12 AND g.opponent_score=28
      AND datetime(g.scheduled_at)>=datetime('now','-168 hours')
      AND (src.parser_type='hootens-statewide' OR lower(COALESCE(g.notes,'')) LIKE '%hooten%')
    ORDER BY datetime(g.updated_at) DESC
    LIMIT 2
  \`).all();
  const sourceRows=sourceResult.results||[];
  if(sourceRows.length!==1) throw new Error(\`expected exactly one Blevins 12-28 Guy-Perkins Hooten source row; found \${sourceRows.length}\`);
  const source=sourceRows[0];

  const targetSchools=await env.DB.prepare(\`
    SELECT s.id AS school_id,s.name AS school_name,t.id AS team_id,t.active AS team_active,t.conference_id
    FROM schools s
    LEFT JOIN teams t ON t.school_id=s.id AND t.sport='football' AND t.gender='boys' AND t.season='2026'
    WHERE s.level='high-school' AND s.state='AR' AND s.catalog_scope='local'
      AND lower(replace(s.name,'-',' '))='guy perkins'
    LIMIT 2
  \`).all();
  const schools=targetSchools.results||[];
  if(schools.length!==1) throw new Error(\`expected exactly one Guy-Perkins school; found \${schools.length}\`);
  const target=schools[0];

  const existing=await env.DB.prepare(\`
    SELECT g.id FROM games g JOIN teams t ON t.id=g.team_id
    WHERE t.school_id=? AND t.sport='football' AND t.gender='boys' AND t.season='2026'
      AND g.status='FINAL' AND g.team_score=28 AND g.opponent_score=12
      AND datetime(g.scheduled_at)>=datetime('now','-168 hours')
      AND (g.opponent_school_id=? OR lower(replace(COALESCE(g.opponent,''),'-',' '))='blevins')
    LIMIT 2
  \`).bind(target.school_id,source.reporting_school_id).all();
  if((existing.results||[]).length>0) return {status:"ALREADY_PRESENT",created:0,sourceRows:1,targetRowsBefore:(existing.results||[]).length,teamId:target.team_id||null};

  let teamId=target.team_id;
  if(!teamId){
    teamId=\`\${target.school_id}-football-2026\`;
    await env.DB.prepare(\`
      INSERT INTO teams(id,school_id,sport,gender,season,conference_id,active,created_at,updated_at)
      VALUES(?,?,'football','boys','2026',?,1,?,?)
      ON CONFLICT(school_id,sport,gender,season) DO UPDATE SET active=1,updated_at=excluded.updated_at
    \`).bind(teamId,target.school_id,target.conference_id||source.opponent_conference_id||null,checkedAt,checkedAt).run();
  } else if(Number(target.team_active??1)!==1){
    await env.DB.prepare("UPDATE teams SET active=1,updated_at=? WHERE id=?").bind(checkedAt,teamId).run();
  }

  const sourceId=\`\${teamId}-hootens-statewide\`;
  await env.DB.prepare(\`
    INSERT INTO sources(id,team_id,source_url,source_type,source_priority,parser_type,parser_version,timezone,expected_min_games,refresh_minutes,active_result_minutes,enabled,authority_rank,stale_after_minutes,collection_mode,updated_at)
    VALUES(?,?,?,'secondary',90,'hootens-statewide','6','America/Chicago',1,30,5,0,90,180,'statewide',?)
    ON CONFLICT(id) DO UPDATE SET source_url=excluded.source_url,parser_version=excluded.parser_version,collection_mode='statewide',updated_at=excluded.updated_at
  \`).bind(sourceId,teamId,scoreboardUrl,checkedAt).run();

  const day=String(source.scheduled_at).slice(0,10);
  const sourceEventKey=\`targeted:guy-perkins-blevins:\${day}\`;
  const id=\`\${sourceId}:\${sourceEventKey}\`;
  const teamScore=28,opponentScore=12;
  await env.DB.prepare(\`
    INSERT INTO games(id,team_id,source_id,source_event_key,opponent,opponent_school_id,scheduled_at,scheduled_time_known,venue,location_text,latitude,longitude,home_away,conference_game,counts_for_record,status,team_score,opponent_score,result,notes,source_url,source_updated_at,last_checked_at,updated_at,canonical_event_id)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(source_id,source_event_key) DO UPDATE SET
      opponent=excluded.opponent,opponent_school_id=excluded.opponent_school_id,scheduled_at=excluded.scheduled_at,
      status='FINAL',team_score=excluded.team_score,opponent_score=excluded.opponent_score,result=excluded.result,
      notes=excluded.notes,source_url=excluded.source_url,source_updated_at=excluded.source_updated_at,
      last_checked_at=excluded.last_checked_at,updated_at=excluded.updated_at,canonical_event_id=excluded.canonical_event_id
  \`).bind(
    id,teamId,sourceId,sourceEventKey,source.reporting_school_name,source.reporting_school_id,source.scheduled_at,
    Number(source.scheduled_time_known??0),source.venue||null,source.location_text||null,source.latitude??null,source.longitude??null,
    reverse(source.home_away),Number(source.conference_game||0),Number(source.counts_for_record??1),"FINAL",
    teamScore,opponentScore,resultCode(teamScore,opponentScore),"Hooten statewide final targeted Guy-Perkins schedule completion",
    scoreboardUrl,checkedAt,checkedAt,checkedAt,source.canonical_event_id||null
  ).run();
  if(source.canonical_event_id){
    await env.DB.prepare(\`INSERT OR REPLACE INTO canonical_event_members(canonical_event_id,game_id,source_id,reporting_team_id,added_at) VALUES(?,?,?,?,?)\`)
      .bind(source.canonical_event_id,id,sourceId,teamId,checkedAt).run();
  }
  await rebuildTeamRecords(env,[teamId],checkedAt);

  const after=await env.DB.prepare(\`
    SELECT COUNT(*) AS n FROM games g JOIN teams t ON t.id=g.team_id
    WHERE t.school_id=? AND t.sport='football' AND t.gender='boys' AND t.season='2026'
      AND g.status='FINAL' AND g.team_score=28 AND g.opponent_score=12
      AND (g.opponent_school_id=? OR lower(replace(COALESCE(g.opponent,''),'-',' '))='blevins')
      AND datetime(g.scheduled_at)>=datetime('now','-168 hours')
  \`).bind(target.school_id,source.reporting_school_id).first();
  if(Number(after?.n||0)!==1) throw new Error(\`target verification expected one Guy-Perkins 28-12 Blevins row; found \${Number(after?.n||0)}\`);
  return {status:"SUCCESS",created:1,sourceRows:1,targetRowsBefore:0,targetRowsAfter:1,teamId};
}
export default {async fetch(request,env){const path=new URL(request.url).pathname;if(!ok(request))return json({error:"not_found"},404);if(request.method==="HEAD"&&path==="/ready")return new Response(null,{status:204});if(request.method==="POST"&&path==="/run"){try{return json(await repair(env));}catch(error){return json({status:"FAILURE",error:String(error?.message||error)},500);}}return json({error:"not_found"},404);}};
`);
NODE

wrangler versions upload "$WRAPPER" --preview-alias "$ALIAS" --keep-vars >/dev/null
TOKEN_ACTIVE=1

READY=""
for ATTEMPT in $(seq 1 20); do
  READY="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 --head -H "x-hootens-target-token: $TOKEN" -H 'cache-control: no-store' "$API/ready" || true)"
  if [ "$READY" = "204" ]; then break; fi
  sleep 3
done
if [ "$READY" != "204" ]; then
  echo "Targeted Guy-Perkins repair preview never became ready" >&2
  exit 1
fi

RUN_OUT="$TMPDIR/run.json"
CODE="$(curl -sS --max-time 120 -o "$RUN_OUT" -w '%{http_code}' -X POST -H "x-hootens-target-token: $TOKEN" -H 'content-type: application/json' -H 'cache-control: no-store' --data '{}' "$API/run")"
cat "$RUN_OUT"
if [ "$CODE" != "200" ]; then
  echo "Targeted Guy-Perkins repair failed HTTP $CODE" >&2
  exit 1
fi
node - "$RUN_OUT" <<'NODE'
const fs=require('fs');const r=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
if(!["SUCCESS","ALREADY_PRESENT"].includes(r.status)) throw new Error(`unexpected repair status ${JSON.stringify(r)}`);
if(Number(r.sourceRows)!==1) throw new Error(`source row count was not 1: ${JSON.stringify(r)}`);
if(r.status==="SUCCESS" && Number(r.created)!==1) throw new Error(`targeted repair did not create exactly one row: ${JSON.stringify(r)}`);
NODE

wrangler versions upload src/logo-bootstrap-worker.js --preview-alias "$ALIAS" --keep-vars >/dev/null
TOKEN_ACTIVE=0

VERIFY_SQL="WITH h AS (
  SELECT last_event_count,details_json FROM statewide_collection_state WHERE id='hootens:football:current'
), recent_raw AS (
  SELECT lower(s.name) AS school_name,lower(COALESCE(g.opponent,'')) AS opponent,g.team_score,g.opponent_score
  FROM games g JOIN teams t ON t.id=g.team_id JOIN schools s ON s.id=t.school_id
  WHERE t.sport='football' AND t.gender='boys' AND t.season='2026' AND g.status='FINAL'
    AND g.team_score IS NOT NULL AND g.opponent_score IS NOT NULL AND datetime(g.scheduled_at)>=datetime('now','-168 hours')
), expected(label,weight,school_pat,opp_pat,team_score,opp_score) AS (
  VALUES
    ('jacksonville-southside',1,'jacksonville','southside',48,20),
    ('corning-lafayette',2,'corning','lafayette',44,8),
    ('cedar-ridge-cave-city',4,'cedar ridge','cave city',34,28),
    ('guy-perkins-blevins',8,'guy%perkins','blevins',28,12),
    ('har-ber-northside',16,'har%ber','northside',45,7),
    ('fort-smith-southside-sallisaw',32,'southside','sallisaw',28,39),
    ('gentry-jay',64,'gentry','jay',38,0),
    ('mansfield-mena',128,'mansfield','mena',52,35),
    ('earle-helena',256,'earle','helena',28,49),
    ('rose-bud-midland',512,'rose bud','midland',36,18)
), found AS (
  SELECT e.weight,EXISTS(SELECT 1 FROM recent_raw r WHERE r.school_name LIKE '%'||e.school_pat||'%' AND r.opponent LIKE '%'||e.opp_pat||'%' AND r.team_score=e.team_score AND r.opponent_score=e.opp_score) present FROM expected e
), conway AS (
  SELECT ce.status,ce.home_score,ce.away_score,lower(COALESCE(hs.name,'')) home_name,lower(COALESCE(aws.name,'')) away_name
  FROM canonical_events ce LEFT JOIN schools hs ON hs.id=ce.home_school_id LEFT JOIN schools aws ON aws.id=ce.away_school_id
  WHERE ce.sport='football' AND ce.gender='boys' AND ce.season='2026' AND datetime(ce.scheduled_at)>=datetime('now','-168 hours')
    AND ((lower(COALESCE(hs.name,'')) LIKE 'conway%' AND lower(COALESCE(aws.name,'')) LIKE 'bentonville%') OR (lower(COALESCE(aws.name,'')) LIKE 'conway%' AND lower(COALESCE(hs.name,'')) LIKE 'bentonville%'))
  ORDER BY datetime(ce.scheduled_at) DESC LIMIT 1
)
SELECT
 (SELECT last_event_count FROM h) finals,
 (SELECT json_extract(details_json,'$.matched') FROM h) matched,
 (SELECT json_extract(details_json,'$.unmatched') FROM h) unmatched,
 (SELECT COUNT(*) FROM found WHERE present=1) recovered_found,
 (SELECT COALESCE(SUM(weight),0) FROM found WHERE present=1) present_mask,
 (SELECT status FROM conway) conway_status,
 CASE WHEN (SELECT home_name FROM conway) LIKE 'conway%' THEN (SELECT home_score FROM conway) ELSE (SELECT away_score FROM conway) END conway_score,
 CASE WHEN (SELECT home_name FROM conway) LIKE 'bentonville%' THEN (SELECT home_score FROM conway) ELSE (SELECT away_score FROM conway) END bentonville_score"
VERIFY_OUT="$TMPDIR/verify.json"
wrangler d1 execute "$DB" --remote --command="$VERIFY_SQL" --json > "$VERIFY_OUT"

MARKER="$(node - "$VERIFY_OUT" <<'NODE'
const fs=require('fs');const payload=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));const envs=Array.isArray(payload)?payload:[payload];const row=envs.flatMap(x=>x?.results||[]).find(Boolean);if(!row)throw new Error('no verification row');const f=Number(row.finals||0),m=Number(row.matched||0),u=Number(row.unmatched||0),r=Number(row.recovered_found||0),k=Number(row.present_mask||0),c=Number(row.conway_score),b=Number(row.bentonville_score),w=envs.reduce((n,x)=>n+Number(x?.meta?.rows_written||x?.meta?.rowsWritten||0),0);if(f<90||m!==f||u!==0||r!==10||k!==1023||row.conway_status!=='FINAL'||c!==14||b!==20||w!==0)throw new Error(`verify failed ${JSON.stringify(row)} writes=${w}`);console.log(`hf-f${f}m${m}u${u}-r${r}k${k}-c${c}x${b}`.slice(0,32));
NODE
)"

node - "$MARKER" > "$RESULT_WRAPPER" <<'NODE'
const marker=process.argv[2];process.stdout.write(`export default {async fetch(){return new Response(${JSON.stringify(marker)},{headers:{"content-type":"text/plain","cache-control":"no-store"}})}};\n`);
NODE
wrangler versions upload "$RESULT_WRAPPER" --preview-alias "$MARKER" --keep-vars
echo "HOOTENS_FINAL_PROOF $MARKER"

# Ensure production ends on the permanent scheduled worker, not a temporary wrapper.
wrangler deploy
