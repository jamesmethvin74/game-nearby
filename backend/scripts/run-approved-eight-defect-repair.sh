#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

HOST="127.0.0.1"
PORT="${EIGHT_DEFECT_REPAIR_PORT:-8798}"
MAX_TIME="${EIGHT_DEFECT_REPAIR_MAX_TIME:-300}"
WRAPPER=".eight-defect-repair-runtime-$$.mjs"
LOG="$(mktemp)"
OUT="$(mktemp)"
WRANGLER_PID=""

cleanup() {
  if [ -n "${WRANGLER_PID}" ]; then
    kill "${WRANGLER_PID}" >/dev/null 2>&1 || true
    wait "${WRANGLER_PID}" >/dev/null 2>&1 || true
  fi
  rm -f "${WRAPPER}" "${LOG}" "${OUT}"
}
trap cleanup EXIT INT TERM

if ! grep -q '"database_name": "localbleachersar-sports"' wrangler.jsonc; then
  echo "Refusing repair: backend/wrangler.jsonc is not bound to localbleachersar-sports" >&2
  exit 2
fi

cat > "${WRAPPER}" <<'EOF'
import { runDueCollections } from "./src/index.js";
import { ensureOneTruthSchema, rebuildOneTruth } from "./src/one-truth.js";

const SOURCE_IDS = [
  "college-arkansas-tech-volleyball-women-2026-sidearm",
  "college-ecclesia-soccer-men-2026-sidearm",
  "college-john-brown-volleyball-women-2026-sidearm",
  "college-ouachita-baptist-volleyball-women-2026-sidearm",
  "college-southern-arkansas-volleyball-women-2026-sidearm",
  "college-uam-volleyball-women-2026-sidearm"
];
const FIXED_TEAM_IDS = [
  "df-xatpsv-volleyball-2026",
  "df-yj7aj5-volleyball-2026"
];
const READY="/__localbleachersar_eight_defect_ready";
const RUN="/__localbleachersar_eight_defect_run";

function json(body,status=200){
  return new Response(JSON.stringify(body),{
    status,
    headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}
  });
}

export default {
  async fetch(request,env) {
    const url=new URL(request.url);
    if(request.method==="GET" && url.pathname===READY) return new Response(null,{status:204});
    if(request.method!=="POST" || url.pathname!==RUN) return json({error:"not_found"},404);

    await ensureOneTruthSchema(env);
    const collection=await runDueCollections(env,{
      force:true,
      sourceIds:SOURCE_IDS,
      reason:"approved-eight-defect-repair"
    });

    if((collection.outcomes||[]).length!==SOURCE_IDS.length || collection.ok!==true) {
      return json({status:"FAILURE",sourceIds:SOURCE_IDS,collection},500);
    }

    const touchedTeamIds=[...new Set([
      ...(collection.touchedTeamIds||[]),
      ...FIXED_TEAM_IDS
    ].map(String).filter(Boolean))].sort();

    const oneTruth=await rebuildOneTruth(env,{teamIds:touchedTeamIds});

    return json({
      status:"SUCCESS",
      sourceIds:SOURCE_IDS,
      touchedTeamIds,
      collection,
      oneTruth
    });
  }
};
EOF

npx wrangler dev "${WRAPPER}" \
  --config wrangler.jsonc \
  --remote \
  --ip "${HOST}" \
  --port "${PORT}" \
  --local-protocol http \
  >"${LOG}" 2>&1 &
WRANGLER_PID="$!"

READY=0
for _ in $(seq 1 30); do
  if curl -fsS --max-time 3 "http://${HOST}:${PORT}/__localbleachersar_eight_defect_ready" -o /dev/null 2>/dev/null; then
    READY=1
    break
  fi
  if ! kill -0 "${WRANGLER_PID}" 2>/dev/null; then
    cat "${LOG}" >&2
    exit 1
  fi
  sleep 1
done

if [ "${READY}" -ne 1 ]; then
  echo "Bounded eight-defect repair harness did not become ready through Wrangler remote dev" >&2
  cat "${LOG}" >&2
  exit 1
fi

HTTP_STATUS="$(curl -sS --max-time "${MAX_TIME}" -o "${OUT}" -w '%{http_code}' -X POST "http://${HOST}:${PORT}/__localbleachersar_eight_defect_run")"

if [ "${HTTP_STATUS}" != "200" ]; then
  echo "Bounded eight-defect repair failed: HTTP ${HTTP_STATUS}" >&2
  cat "${OUT}" >&2 || true
  cat "${LOG}" >&2 || true
  exit 1
fi

node - "${OUT}" <<'NODE'
const fs=require('fs');
const p=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
if(p.status!=="SUCCESS") throw new Error("Bounded repair did not return SUCCESS");
if(!Array.isArray(p.sourceIds)||p.sourceIds.length!==6) throw new Error("Six-source scope violated");
if((p.collection?.outcomes||[]).length!==6||p.collection?.ok!==true) throw new Error("Collection scope/outcome failed");
console.log(JSON.stringify({
  status:p.status,
  sourceIds:p.sourceIds,
  touchedTeamIds:p.touchedTeamIds,
  outcomes:(p.collection.outcomes||[]).map(x=>({
    sourceId:x.sourceId,
    status:x.status,
    gamesSeen:x.gamesSeen??null,
    touchedTeamIds:x.touchedTeamIds||[]
  })),
  oneTruth:p.oneTruth
}));
NODE

echo "BOUNDED_EIGHT_DEFECT_REPAIR_COMPLETE"
