import test from "node:test";
import assert from "node:assert/strict";
import { rebuildStandingsForTeams } from "../src/calculated-standings.js";

test("legacy coverage_complete cannot suppress a touched conference cohort", async () => {
  const writes=[];
  const db={
    prepare(sql){
      return {
        sql,args:[],
        bind(...args){this.args=args;return this;},
        async all(){
          if(sql.includes("SELECT DISTINCT t.conference_id")) {
            return {results:[{
              conference_id:"5a-central-volleyball",
              sport:"volleyball",
              gender:"girls",
              season:"2026",
              standings_method:"calculated",
              coverage_complete:1
            }]};
          }
          if(sql.includes("SELECT t.id AS team_id,s.name AS school_name")) {
            return {results:[
              {team_id:"alpha-volleyball-2026",school_name:"Alpha",wins:4,losses:1,ties:0,conference_wins:2,conference_losses:0,conference_ties:0},
              {team_id:"beta-volleyball-2026",school_name:"Beta",wins:3,losses:2,ties:0,conference_wins:1,conference_losses:1,conference_ties:0}
            ]};
          }
          throw new Error(`unexpected query: ${sql}`);
        }
      };
    },
    async batch(statements){
      writes.push(...statements.map(statement=>({sql:statement.sql,args:statement.args})));
      return statements.map(()=>({success:true,meta:{rows_written:1}}));
    }
  };

  const result=await rebuildStandingsForTeams(
    {DB:db},
    ["alpha-volleyball-2026"],
    "2026-09-15T21:00:00.000Z"
  );

  assert.deepEqual(result,{cohorts:1,standingsRows:2});
  assert.equal(writes.length,2);
  assert.deepEqual(writes.map(row=>[row.args[1],row.args[2],row.args[3]]),[
    ["alpha-volleyball-2026",1,"2-0"],
    ["beta-volleyball-2026",2,"1-1"]
  ]);
});
