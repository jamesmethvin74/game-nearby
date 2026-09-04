import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  COLLEGE_BOOTSTRAP_MAX_SOURCES_PER_RUN,
  runScopedCadence,
  scopePolicy
} from "../src/scoped-cadence-runner.js";
import {
  COLLEGE_SOURCE_ACTIVATE_SQL,
  COLLEGE_SOURCE_PREPARE_SQL,
  COLLEGE_TEAM_ACTIVATION_SQL,
  collegeProductionActivationPlan
} from "../src/college-production-activation.js";
import { COLLEGE_SCHOOL_INSERT_SQL, COLLEGE_TEAM_INSERT_SQL } from "../src/college-catalog.js";
import { COLLEGE_BOOTSTRAP_PATH, runCollegeBootstrap } from "../src/m4-public-worker.js";

const migrationDir = new URL("../migrations/", import.meta.url);

function buildDb() {
  const db = new DatabaseSync(":memory:");
  for (const file of fs.readdirSync(migrationDir).filter(name => name.endsWith(".sql")).sort()) {
    db.exec(fs.readFileSync(new URL(file, migrationDir), "utf8"));
  }
  return db;
}

function d1Adapter(db) {
  return {
    prepare(sql) {
      let args=[];
      return {
        bind(...values) { args=values; return this; },
        async all() {
          return { results:db.prepare(sql).all(...args), meta:{rows_read:0,rows_written:0,duration:0} };
        },
        async first() {
          return db.prepare(sql).get(...args) || null;
        },
        async run() {
          const result=db.prepare(sql).run(...args);
          return { meta:{rows_read:0,rows_written:Number(result.changes||0),duration:0} };
        }
      };
    }
  };
}

function prepareAndActivate(db) {
  const plan=collegeProductionActivationPlan("2026");
  db.prepare(COLLEGE_SCHOOL_INSERT_SQL).run(JSON.stringify(plan.schools));
  db.prepare(COLLEGE_TEAM_INSERT_SQL).run(JSON.stringify(plan.teams));
  db.prepare(COLLEGE_TEAM_ACTIVATION_SQL).run(JSON.stringify(plan.certifiedTargets),JSON.stringify(plan.teams));
  db.prepare(COLLEGE_SOURCE_PREPARE_SQL).run(JSON.stringify(plan.sourceRows));
  db.prepare(COLLEGE_SOURCE_ACTIVATE_SQL).run(JSON.stringify(plan.sourceRows),JSON.stringify(plan.teams));
  return plan;
}

function fakeCore(db,calls) {
  return {
    async fetch(request) {
      const body=await request.json();
      const sourceIds=Array.isArray(body.sourceIds)?body.sourceIds:[];
      calls.push(sourceIds);
      if (sourceIds.length) {
        const placeholders=sourceIds.map(()=>"?").join(",");
        db.prepare(`UPDATE sources SET last_checked_at='2026-09-04T03:00:00.000Z' WHERE id IN (${placeholders})`).run(...sourceIds);
      }
      return new Response(JSON.stringify({status:"SUCCESS"}),{status:200,headers:{"content-type":"application/json"}});
    }
  };
}

test("M4 initial ingestion scope is manual-only, 2026-college-only, and capped at eight", () => {
  const policy=scopePolicy({scope:"college-bootstrap",season:"2026"});
  assert.equal(policy.maxSources,COLLEGE_BOOTSTRAP_MAX_SOURCES_PER_RUN);
  assert.equal(policy.maxSources,8);
  assert.equal(policy.dueMode,"bootstrap");
  assert.match(policy.where,/sch\.level='college'/);
  assert.match(policy.where,/t\.season='2026'/);
  assert.match(policy.gameWindow,/NOT EXISTS/);
  assert.match(policy.gameWindow,/gx\.source_id=src\.id/);

  const cadence=fs.readFileSync(new URL("../src/collection-cadence.js",import.meta.url),"utf8");
  assert.doesNotMatch(cadence,/college-bootstrap/);
});

test("M4 initial ingestion excludes populated sources and high schools and rotates attempted failures behind untouched sources", async () => {
  const db=buildDb();
  const plan=prepareAndActivate(db);
  assert.equal(plan.counts.ready,103);

  const populated=db.prepare(`
    SELECT src.id source_id,src.team_id,src.source_url
    FROM sources src
    JOIN teams t ON t.id=src.team_id
    JOIN schools s ON s.id=t.school_id
    WHERE src.enabled=1 AND t.active=1 AND t.season='2026' AND s.level='college'
    ORDER BY src.id
    LIMIT 1
  `).get();
  assert.ok(populated);
  db.prepare(`
    INSERT INTO games
      (id,team_id,source_id,source_event_key,opponent,scheduled_at,home_away,status,source_url,source_updated_at,last_checked_at)
    VALUES
      ('m4-existing-game',?,?, 'existing','Existing Opponent','2026-09-12T18:00:00.000Z','home','SCHEDULED',?,'2026-09-04T00:00:00.000Z','2026-09-04T00:00:00.000Z')
  `).run(populated.team_id,populated.source_id,populated.source_url);

  const env={DB:d1Adapter(db)};
  const firstCalls=[];
  const first=await runScopedCadence({
    core:fakeCore(db,firstCalls),env,ctx:{},controller:null,
    plan:{kind:"m4-college-initial-ingestion",scope:"college-bootstrap",season:"2026"}
  });
  const firstIds=firstCalls.flat();
  assert.equal(first.selectedSources,8);
  assert.equal(firstIds.length,8);
  assert.ok(!firstIds.includes(populated.source_id),"a source with an existing game row must not be bootstrapped again");
  assert.ok(!firstIds.includes("conway-football-official"),"high-school source must never enter college bootstrap");

  const firstScope=db.prepare(`
    SELECT COUNT(*) n
    FROM sources src
    JOIN teams t ON t.id=src.team_id
    JOIN schools s ON s.id=t.school_id
    WHERE src.id IN (${firstIds.map(()=>"?").join(",")})
      AND src.enabled=1 AND t.active=1 AND t.season='2026' AND s.level='college' AND s.catalog_scope='local'
  `).get(...firstIds);
  assert.equal(Number(firstScope.n),firstIds.length);

  // The fake core records an attempted check but intentionally creates no game
  // rows, simulating a provider failure/no-data result. Untouched NULL-checked
  // sources must therefore be chosen before these attempted rows next time.
  const secondCalls=[];
  const second=await runScopedCadence({
    core:fakeCore(db,secondCalls),env,ctx:{},controller:null,
    plan:{kind:"m4-college-initial-ingestion",scope:"college-bootstrap",season:"2026"}
  });
  const secondIds=secondCalls.flat();
  assert.equal(second.selectedSources,8);
  assert.equal(secondIds.length,8);
  assert.deepEqual(firstIds.filter(id=>secondIds.includes(id)),[],"failed/empty attempts must not block untouched bootstrap sources");
});

test("M4 bootstrap endpoint is POST-only, token-protected, and not public-cacheable", async () => {
  assert.equal(COLLEGE_BOOTSTRAP_PATH,"/api/v1/m4/college-bootstrap");
  const worker=fs.readFileSync(new URL("../src/m4-public-worker.js",import.meta.url),"utf8");
  assert.match(worker,/request\.method === "POST" && url\.pathname === COLLEGE_BOOTSTRAP_PATH/);
  assert.match(worker,/x-refresh-token/);
  assert.match(worker,/cache-control": "no-store"/);
  assert.match(worker,/scope:"college-bootstrap"/);

  const unauthorized=await runCollegeBootstrap(
    new Request(`https://example.test${COLLEGE_BOOTSTRAP_PATH}`,{method:"POST",headers:{"x-refresh-token":"wrong"}}),
    {REFRESH_TOKEN:"secret"},
    {}
  );
  assert.equal(unauthorized.status,404);
});
