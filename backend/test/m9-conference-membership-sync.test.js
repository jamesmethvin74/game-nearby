import test from "node:test";
import assert from "node:assert/strict";
import { syncConferenceMembershipTruth } from "../src/conference-membership-truth.js";

function mockEnv() {
  const prepared=[];
  return {
    prepared,
    DB:{
      prepare(sql){
        const statement={sql,args:[],bind(...args){this.args=args;return this;}};
        prepared.push(statement);
        return statement;
      },
      async batch(statements){
        assert.equal(statements.length,2);
        return [{meta:{changes:2}},{meta:{changes:1}}];
      }
    }
  };
}

const memberships=[
  {
    team_id:"a-football-2026",membership_state:"member",conference_id:"7a-central-football",
    classification:"7A",division:"Central",authority_provider:"arkansas-aaa",
    authority_key:"2026:FB:A",source_url:"https://www.ahsaa.org/",verified_at:"2026-09-15T12:00:00Z"
  },
  {
    team_id:"b-football-2026",membership_state:"independent",conference_id:null,
    authority_provider:"arkansas-aaa",authority_key:"2026:FB:B",source_url:"https://www.ahsaa.org/",
    verified_at:"2026-09-15T12:00:00Z"
  }
];

test("M9 dry run validates authoritative payload without any D1 statements", async () => {
  const env=mockEnv();
  const result=await syncConferenceMembershipTruth(env,memberships,{dryRun:true,maxRows:2});
  assert.equal(result.status,"DRY_RUN");
  assert.equal(result.rows,2);
  assert.equal(result.d1_statements,0);
  assert.equal(env.prepared.length,0);
});

test("M9 sync is two set-based statements, not N+1 writes", async () => {
  const env=mockEnv();
  const result=await syncConferenceMembershipTruth(env,memberships,{maxRows:2,now:new Date("2026-09-15T12:30:00Z")});
  assert.equal(result.status,"SUCCESS");
  assert.equal(result.d1_statements,2);
  assert.equal(result.membership_writes,2);
  assert.equal(result.team_pointer_writes,1);
  assert.equal(env.prepared.length,2);
  assert.match(env.prepared[0].sql,/json_each\(\?\)/);
  assert.match(env.prepared[0].sql,/INSERT INTO conference_memberships/);
  assert.match(env.prepared[1].sql,/UPDATE teams AS t/);
  assert.match(env.prepared[1].sql,/FROM payload AS p/);
  assert.match(env.prepared[1].sql,/t\.id=p\.team_id/);
  assert.match(env.prepared[1].sql,/membership_state.*member/s);
  assert.doesNotMatch(env.prepared[1].sql,/SELECT p\.conference_id FROM payload/);
});

test("M9 write fuse and duplicate-team guard fail closed before D1", async () => {
  const env=mockEnv();
  await assert.rejects(syncConferenceMembershipTruth(env,memberships,{maxRows:1}),/row fuse exceeded/);
  await assert.rejects(syncConferenceMembershipTruth(env,[memberships[0],memberships[0]],{maxRows:2}),/duplicate/);
  assert.equal(env.prepared.length,0);
});
