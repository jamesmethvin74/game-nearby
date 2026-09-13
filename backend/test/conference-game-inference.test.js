import test from "node:test";
import assert from "node:assert/strict";
import { attachEffectiveConferenceGames } from "../src/conference-game-inference.js";

test("conference inference uses one bounded opponent membership read and exact identity", async () => {
  let prepares = 0;
  let sql = "";
  let binds = [];
  const env = {
    DB: {
      prepare(value) {
        prepares += 1;
        sql = value;
        return {
          bind(...values) {
            binds = values;
            return {
              async all() {
                return {
                  results: [
                    { school_id:"opp-a", sport:"football", gender:"boys", season:"2026", conference_id:"5a-south" },
                    { school_id:"opp-b", sport:"football", gender:"boys", season:"2026", conference_id:"4a-north" }
                  ]
                };
              }
            };
          }
        };
      }
    }
  };

  const rows = [
    {
      id:"explicit", school_id:"home", opponent_school_id:"opp-z",
      sport:"football", gender:"boys", season:"2026", conference_id:"5a-south",
      conference_game:1
    },
    {
      id:"match", school_id:"home", opponent_school_id:"opp-a",
      sport:"football", gender:"boys", season:"2026", conference_id:"5a-south",
      conference_game:0
    },
    {
      id:"wrong-conference", school_id:"home", opponent_school_id:"opp-b",
      sport:"football", gender:"boys", season:"2026", conference_id:"5a-south",
      conference_game:0
    },
    {
      id:"canonical", school_id:"home", canonical_event_id:"ce-1",
      canonical_home_school_id:"home", canonical_away_school_id:"opp-a",
      sport:"football", gender:"boys", season:"2026", conference_id:"5a-south",
      conference_game:0, canonical_conference_game:0
    }
  ];

  const result = await attachEffectiveConferenceGames(env, rows);

  assert.equal(prepares, 1);
  assert.match(sql, /FROM teams/);
  assert.match(sql, /WHERE active=1/);
  assert.match(sql, /conference_id IS NOT NULL/);
  assert.match(sql, /school_id IN \(\?,\?\)/);
  assert.doesNotMatch(sql, /INDEXED BY idx_teams_school_active_season/);
  assert.doesNotMatch(sql, /EXISTS\s*\(/);
  assert.deepEqual(new Set(binds), new Set(["opp-a", "opp-b"]));
  assert.deepEqual(result.map(row => row.effective_conference_game), [1,1,0,1]);
});

test("conference inference performs zero D1 reads when no membership lookup is needed", async () => {
  const env = { DB: { prepare() { throw new Error("unexpected D1 read"); } } };
  const result = await attachEffectiveConferenceGames(env, [
    { id:"explicit", school_id:"home", sport:"volleyball", gender:"girls", season:"2026", conference_id:"6a-central", conference_game:1 },
    { id:"unknown", school_id:"home", sport:"volleyball", gender:"girls", season:"2026", conference_id:null, conference_game:0 }
  ]);
  assert.deepEqual(result.map(row => row.effective_conference_game), [1,0]);
});