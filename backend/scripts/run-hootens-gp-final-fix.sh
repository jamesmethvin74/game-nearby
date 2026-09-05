#!/usr/bin/env bash
set -euo pipefail
TMP="scripts/.run-hootens-direct-gp-finish.corrected.sh"
trap 'rm -f "$TMP"' EXIT
sed "s/lower(replace(s.name,'-',' '))='guy perkins'/lower(replace(s.name,'-',' ')) LIKE 'guy%perkins%'/g" scripts/run-hootens-direct-gp-finish.sh > "$TMP"
chmod +x "$TMP"
bash "$TMP"
