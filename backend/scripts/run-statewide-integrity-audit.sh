#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

SEASON="${AUDIT_SEASON:-2026}"
SAMPLE_LIMIT="${AUDIT_SAMPLE_LIMIT:-1000}"
PORT="${AUDIT_PORT:-8797}"
HOST="127.0.0.1"
WRAPPER=".statewide-integrity-audit-runtime-$$.mjs"
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
  echo "Refusing audit: backend/wrangler.jsonc is not bound to localbleachersar-sports" >&2
  exit 2
fi

if ! [[ "${SAMPLE_LIMIT}" =~ ^[0-9]+$ ]] || [ "${SAMPLE_LIMIT}" -lt 1 ]; then
  echo "AUDIT_SAMPLE_LIMIT must be a positive integer" >&2
  exit 2
fi

cat > "${WRAPPER}" <<EOF
import { buildStatewideDataIntegrityAudit } from "./src/statewide-data-integrity-audit.js";

const SEASON = ${SEASON@Q};
const SAMPLE_LIMIT = Number(${SAMPLE_LIMIT@Q});

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method !== "GET" || url.pathname !== "/__localbleachersar_statewide_integrity_audit") {
      return new Response("not found", { status: 404 });
    }

    const started = Date.now();
    const result = await buildStatewideDataIntegrityAudit(env, {
      season: SEASON,
      sampleLimit: SAMPLE_LIMIT
    });

    return new Response(JSON.stringify({
      ...result,
      operator_surface: "wrangler-remote-readonly",
      operator_duration_ms: Date.now() - started
    }), {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store"
      }
    });
  }
};
EOF

# The wrapper is a local execution harness only. It is never committed or deployed
# to the production Worker. --remote gives it the configured remote Cloudflare
# bindings, including the production D1 database, while the audit itself performs
# read-only SELECT work.
npx wrangler dev "${WRAPPER}"   --config wrangler.jsonc   --remote   --ip "${HOST}"   --port "${PORT}"   --local-protocol http   >"${LOG}" 2>&1 &
WRANGLER_PID="$!"

READY=0
for _ in $(seq 1 30); do
  if curl -fsS --max-time 3     "http://${HOST}:${PORT}/__localbleachersar_statewide_integrity_audit"     -o "${OUT}" 2>/dev/null; then
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
  echo "Statewide integrity audit did not become reachable through Wrangler remote dev" >&2
  cat "${LOG}" >&2
  exit 1
fi

node - "${OUT}" <<'NODE'
const fs = require('fs');
const path = process.argv[2];
const payload = JSON.parse(fs.readFileSync(path, 'utf8'));

const rowsWritten = Number(payload?.d1?.rows_written ?? payload?.d1?.rowsWritten ?? 0);
if (rowsWritten !== 0) {
  throw new Error(`Read-only statewide audit reported rows_written=${rowsWritten}`);
}

process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
NODE
