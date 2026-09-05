#!/usr/bin/env bash
set -euo pipefail

DB="localbleachersar-sports"
PREVIEW_ALIAS="official-final-results"
API="https://${PREVIEW_ALIAS}-localbleachersar-sports-api.james-methvin74.workers.dev"
READY_PATH="/api/v1/ops/official-final-results/ready"
RUN_PATH="/api/v1/ops/official-final-results/run"
WRAPPER="src/_official-final-results-exec.mjs"
TMPDIR="$(mktemp -d)"
TOKEN=""
TOKEN_ACTIVE=0

cleanup() {
  if [ "$TOKEN_ACTIVE" = "1" ]; then
    wrangler versions upload src/logo-bootstrap-worker.js --preview-alias "$PREVIEW_ALIAS" --keep-vars >/dev/null 2>&1 || true
  fi
  rm -f "$WRAPPER"
  rm -rf "$TMPDIR"
}
trap cleanup EXIT

# Safety preflight: production must already be through 0013 and this branch must
# contain no migration newer than the two explicitly approved result-source migrations.
LAST_REPO_MIGRATION="$(find migrations -maxdepth 1 -type f -name '*.sql' -printf '%f\n' | sort | tail -1)"
if [ "$LAST_REPO_MIGRATION" != "0015_official_school_final_result_sources_batch2.sql" ]; then
  echo "Unexpected repo migration tail: $LAST_REPO_MIGRATION" >&2
  exit 1
fi

PRECHECK_OUT="$TMPDIR/precheck.json"
wrangler d1 execute "$DB" --remote --command="SELECT SUM(CASE WHEN name='0013_milestone1_complete_team_materialization.sql' THEN 1 ELSE 0 END) AS has_0013, SUM(CASE WHEN name='0014_official_school_final_result_sources.sql' THEN 1 ELSE 0 END) AS has_0014, SUM(CASE WHEN name='0015_official_school_final_result_sources_batch2.sql' THEN 1 ELSE 0 END) AS has_0015 FROM d1_migrations" --json > "$PRECHECK_OUT"
read -r HAS_0013 HAS_0014 HAS_0015 <<<"$(node - "$PRECHECK_OUT" <<'NODE'
const fs=require('fs');
const p=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const envs=Array.isArray(p)?p:[p];
const row=envs.flatMap(x=>x?.results||[]).find(Boolean)||{};
console.log([Number(row.has_0013||0),Number(row.has_0014||0),Number(row.has_0015||0)].join(' '));
NODE
)"
if [ "$HAS_0013" -ne 1 ]; then
  echo "Production D1 is not safely through migration 0013; refusing approved 0014/0015 activation" >&2
  exit 1
fi

# Apply only the repo-pending migrations. Because the branch is hard-gated above
# at 0015 and production is proven through 0013, this can only apply 0014/0015.
if [ "$HAS_0014" -ne 1 ] || [ "$HAS_0015" -ne 1 ]; then
  wrangler d1 migrations apply "$DB" --remote
else
  echo "MIGRATIONS_ALREADY_APPLIED 0014=1 0015=1"
fi

# Idempotency guard: a retried Cloudflare build must not advance into another
# 16-source batch. Newly seeded result sources have NULL last_checked_at until
# the one approved pass touches them.
GUARD_OUT="$TMPDIR/guard.json"
wrangler d1 execute "$DB" --remote --command="SELECT COUNT(*) AS already_checked FROM sources src JOIN teams t ON t.id=src.team_id JOIN schools sch ON sch.id=t.school_id WHERE sch.level='high-school' AND src.id LIKE '%-official-school-results' AND src.source_type='official-school' AND src.parser_type IN ('mascot-media','rankone-public') AND src.last_checked_at IS NOT NULL" --json > "$GUARD_OUT"
ALREADY_CHECKED="$(node - "$GUARD_OUT" <<'NODE'
const fs=require('fs');
const p=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const row=(Array.isArray(p)?p:[p]).flatMap(x=>x?.results||[]).find(Boolean)||{};
process.stdout.write(String(Number(row.already_checked||0)));
NODE
)"
if [ "$ALREADY_CHECKED" -gt 0 ]; then
  echo "OFFICIAL_FINAL_RESULTS_ALREADY_ATTEMPTED checkedSources=$ALREADY_CHECKED"
  exit 0
fi

TOKEN="$(node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))")"
node - "$TOKEN" > "$WRAPPER" <<'NODE'
const token=process.argv[2];
process.stdout.write(`import core from "./index.js";\nimport { runScopedCadence } from "./scoped-cadence-runner.js";\nconst TOKEN=${JSON.stringify(token)};\nconst READY="/api/v1/ops/official-final-results/ready";\nconst RUN="/api/v1/ops/official-final-results/run";\nfunction ok(req){return req.headers.get("x-official-results-token")===TOKEN;}\nfunction json(body,status=200){return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});}\nexport default {async fetch(request,env,ctx){const path=new URL(request.url).pathname;if(request.method==="HEAD"&&path===READY)return ok(request)?new Response(null,{status:204,headers:{"cache-control":"no-store"}}):json({error:"not_found"},404);if(request.method==="POST"&&path===RUN){if(!ok(request))return json({error:"not_found"},404);const result=await runScopedCadence({core,env,ctx,controller:null,plan:{kind:"approved-official-final-results",scope:"high-school-final-results",activeResultMinutes:120}});return json(result||{status:"SKIPPED"});}return json({error:"not_found"},404);}};\n`);
NODE

# Isolated preview version, same production D1 binding, no production Worker deploy.
wrangler versions upload "$WRAPPER" --preview-alias "$PREVIEW_ALIAS" --keep-vars
TOKEN_ACTIVE=1

READY_STATUS=""
for ATTEMPT in $(seq 1 20); do
  READY_STATUS="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 --head \
    -H "x-official-results-token: $TOKEN" -H 'cache-control: no-store' "$API$READY_PATH" || true)"
  if [ "$READY_STATUS" = "204" ]; then
    echo "OFFICIAL_FINAL_RESULTS_READY attempt=$ATTEMPT"
    break
  fi
  sleep 3
done
if [ "$READY_STATUS" != "204" ]; then
  echo "Official-result preview never became ready" >&2
  exit 1
fi

RUN_STARTED="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
RUN_OUT="$TMPDIR/run.json"
CODE="$(curl -sS --max-time 300 -o "$RUN_OUT" -w '%{http_code}' -X POST \
  -H 'accept: application/json' -H 'content-type: application/json' -H 'cache-control: no-store' \
  -H "x-official-results-token: $TOKEN" --data '{}' "$API$RUN_PATH")"
if [ "$CODE" != "200" ]; then
  echo "Official-result pass failed: HTTP $CODE" >&2
  cat "$RUN_OUT" >&2 || true
  exit 1
fi

read -r RUN_STATUS SELECTED ATTEMPTED SELECTOR_ROWS <<<"$(node - "$RUN_OUT" <<'NODE'
const fs=require('fs');
const p=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const selected=Number(p.selectedSources ?? p.sources ?? 0);
const attempted=Number(p.attemptedSources ?? 0);
const rows=Number(p.selectorRowsRead ?? 0);
if(selected>16||attempted>16) throw new Error(`16-source cap violated selected=${selected} attempted=${attempted}`);
console.log([String(p.status||''),selected,attempted,rows].join(' '));
NODE
)"
echo "OFFICIAL_FINAL_RESULTS_PASS status=$RUN_STATUS selected=$SELECTED attempted=$ATTEMPTED selectorRowsRead=$SELECTOR_ROWS"

# Remove the temporary execution credential before verification.
wrangler versions upload src/logo-bootstrap-worker.js --preview-alias "$PREVIEW_ALIAS" --keep-vars
TOKEN_ACTIVE=0

# Exactly one combined post-run production verification: migration state, source
# activation, sources touched by this pass, official finals, canonical finals,
# and recent Conway results in one set-based statement.
VERIFY_SQL="WITH official_sources AS (
  SELECT src.id,src.team_id,src.last_checked_at,t.school_id,t.sport,t.gender
  FROM sources src
  JOIN teams t ON t.id=src.team_id
  JOIN schools sch ON sch.id=t.school_id
  WHERE sch.level='high-school'
    AND src.enabled=1
    AND src.source_type='official-school'
    AND src.parser_type IN ('mascot-media','rankone-public')
    AND t.sport IN ('football','volleyball','basketball')
), official_final_obs AS (
  SELECT g.id,g.team_id,g.source_id,g.scheduled_at,g.team_score,g.opponent_score,g.canonical_event_id,g.updated_at
  FROM games g
  JOIN official_sources os ON os.id=g.source_id
  WHERE g.status='FINAL' AND g.team_score IS NOT NULL AND g.opponent_score IS NOT NULL
), canonical_official_finals AS (
  SELECT DISTINCT ce.id,ce.sport,ce.scheduled_at,ce.home_school_id,ce.away_school_id,ce.home_score,ce.away_score,ce.updated_at
  FROM canonical_events ce
  JOIN canonical_event_members cem ON cem.canonical_event_id=ce.id
  JOIN official_sources os ON os.id=cem.source_id
  WHERE ce.status='FINAL' AND ce.home_score IS NOT NULL AND ce.away_score IS NOT NULL
), migration_state AS (
  SELECT
    MAX(CASE WHEN name='0014_official_school_final_result_sources.sql' THEN 1 ELSE 0 END) AS has_0014,
    MAX(CASE WHEN name='0015_official_school_final_result_sources_batch2.sql' THEN 1 ELSE 0 END) AS has_0015
  FROM d1_migrations
)
SELECT
  (SELECT has_0014 FROM migration_state) AS migration_0014,
  (SELECT has_0015 FROM migration_state) AS migration_0015,
  (SELECT COUNT(*) FROM official_sources) AS official_sources,
  (SELECT COUNT(DISTINCT school_id) FROM official_sources) AS official_schools,
  (SELECT COUNT(*) FROM official_sources WHERE datetime(last_checked_at)>=datetime('$RUN_STARTED')) AS sources_checked_this_pass,
  (SELECT COUNT(*) FROM official_final_obs) AS official_final_observations,
  (SELECT COUNT(*) FROM official_final_obs WHERE datetime(updated_at)>=datetime('$RUN_STARTED')) AS final_observations_updated_this_pass,
  (SELECT COUNT(*) FROM canonical_official_finals) AS canonical_official_finals,
  (SELECT COUNT(*) FROM canonical_official_finals WHERE datetime(updated_at)>=datetime('$RUN_STARTED')) AS canonical_finals_updated_this_pass,
  COALESCE((SELECT json_group_array(json_object('id',id,'sport',sport,'scheduled_at',scheduled_at,'home_school_id',home_school_id,'away_school_id',away_school_id,'home_score',home_score,'away_score',away_score)) FROM canonical_official_finals WHERE datetime(scheduled_at)>=datetime('now','-2 days')),'[]') AS recent_finals,
  COALESCE((SELECT json_group_array(json_object('id',id,'sport',sport,'scheduled_at',scheduled_at,'home_school_id',home_school_id,'away_school_id',away_school_id,'home_score',home_score,'away_score',away_score)) FROM canonical_official_finals WHERE (home_school_id='conway' OR away_school_id='conway') AND datetime(scheduled_at)>=datetime('now','-7 days')),'[]') AS conway_recent_finals"
VERIFY_OUT="$TMPDIR/verification.json"
wrangler d1 execute "$DB" --remote --command="$VERIFY_SQL" --json > "$VERIFY_OUT"

node - "$VERIFY_OUT" "$SELECTED" "$ATTEMPTED" "$SELECTOR_ROWS" <<'NODE'
const fs=require('fs');
const [path,selected,attempted,selectorRowsRead]=process.argv.slice(2);
const p=JSON.parse(fs.readFileSync(path,'utf8'));
const row=(Array.isArray(p)?p:[p]).flatMap(x=>x?.results||[]).find(Boolean);
if(!row) throw new Error('Combined production verification returned no row');
const result={
  migration0014:Number(row.migration_0014||0),
  migration0015:Number(row.migration_0015||0),
  officialSources:Number(row.official_sources||0),
  officialSchools:Number(row.official_schools||0),
  sourcesCheckedThisPass:Number(row.sources_checked_this_pass||0),
  officialFinalObservations:Number(row.official_final_observations||0),
  finalObservationsUpdatedThisPass:Number(row.final_observations_updated_this_pass||0),
  canonicalOfficialFinals:Number(row.canonical_official_finals||0),
  canonicalFinalsUpdatedThisPass:Number(row.canonical_finals_updated_this_pass||0),
  recentFinals:typeof row.recent_finals==='string'?JSON.parse(row.recent_finals):row.recent_finals,
  conwayRecentFinals:typeof row.conway_recent_finals==='string'?JSON.parse(row.conway_recent_finals):row.conway_recent_finals,
  selectedSources:Number(selected),
  attemptedSources:Number(attempted),
  selectorRowsRead:Number(selectorRowsRead)
};
if(result.migration0014!==1||result.migration0015!==1) throw new Error(`Approved migrations not both applied: ${JSON.stringify(result)}`);
if(result.selectedSources>16||result.attemptedSources>16||result.sourcesCheckedThisPass>16) throw new Error(`Bounded pass exceeded 16 sources: ${JSON.stringify(result)}`);
console.log(JSON.stringify({status:'OFFICIAL_FINAL_RESULTS_ACTIVATION_VERIFIED',...result}));
NODE
