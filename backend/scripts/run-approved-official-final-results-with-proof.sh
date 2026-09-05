#!/usr/bin/env bash
set -euo pipefail

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

bash scripts/run-approved-official-final-results-activation.sh | tee "$TMP"

if ! grep -q 'OFFICIAL_FINAL_RESULTS_ACTIVATION_VERIFIED' "$TMP"; then
  echo "Official final-result activation did not emit verified completion marker" >&2
  exit 1
fi

wrangler versions upload src/logo-bootstrap-worker.js \
  --preview-alias "official-final-results-verified" \
  --keep-vars

echo "OFFICIAL_FINAL_RESULTS_PROOF_ALIAS published=official-final-results-verified"
