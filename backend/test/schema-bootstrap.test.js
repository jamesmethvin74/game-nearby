import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../src/schema-bootstrap.js", import.meta.url), "utf8");

test("statewide schema bootstrap covers migrations 0005 through 0009", () => {
  for (const name of [
    "0005_statewide_volleyball_discovery.sql",
    "0006_school_location_enrichment.sql",
    "0007_canonical_game_location_propagation.sql",
    "0008_statewide_catalog_visibility.sql",
    "0009_arkansas_catalog_scope.sql"
  ]) assert.match(source, new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

  for (const token of [
    "collection_mode",
    "school_external_identities",
    "school_location_sync_state",
    "trg_games_inherit_canonical_location_insert",
    "trg_statewide_team_scope_updates_source_authority",
    "catalog_scope",
    "trg_dragonfly_school_starts_unverified",
    "d1_migrations"
  ]) assert.match(source, new RegExp(token));
});
