import test from "node:test";
import assert from "node:assert/strict";
import { buildRecordsFromInputs } from "../src/record-rebuild.js";

test("record rebuild combines canonical and school-feed finals without double counting", () => {
  const teams = [{
    id:"conway-volleyball-2026",school_id:"conway",sport:"volleyball",gender:"girls",season:"2026",conference_id:"6a-central-volleyball"
  }];
  const canonicals = [
    {
      id:"ce-lakeside-a",reporting_team_id:"conway-volleyball-2026",sport:"volleyball",gender:"girls",season:"2026",
      home_school_id:"conway",away_school_id:"lakeside",home_name:"Conway High School",away_name:"Lakeside High School (Hot Springs)",
      scheduled_at:"2026-08-31T23:00:00.000Z",status:"FINAL",home_score:3,away_score:0,conference_game:0,counts_for_record:1,trust_state:"AUTHORITATIVE_LIVE"
    },
    {
      id:"ce-lakeside-b",reporting_team_id:"conway-volleyball-2026",sport:"volleyball",gender:"girls",season:"2026",
      home_school_id:"conway",away_school_id:"lakeside",home_name:"Conway High School",away_name:"Lakeside High School (Hot Springs)",
      scheduled_at:"2026-08-31T23:00:00.000Z",status:"FINAL",home_score:3,away_score:0,conference_game:0,counts_for_record:1,trust_state:"CORROBORATED"
    },
    {
      id:"ce-benton",reporting_team_id:"conway-volleyball-2026",sport:"volleyball",gender:"girls",season:"2026",
      home_school_id:"benton",away_school_id:"conway",home_name:"Benton High School",away_name:"Conway High School",
      scheduled_at:"2026-09-01T23:00:00.000Z",status:"FINAL",home_score:3,away_score:1,conference_game:1,counts_for_record:1,trust_state:"CORROBORATED"
    }
  ];
  const raw = [
    {
      id:"school-lakeside",team_id:"conway-volleyball-2026",school_id:"conway",opponent:"Lakeside",opponent_school_id:"lakeside",
      scheduled_at:"2026-08-31T23:00:00.000Z",status:"FINAL",team_score:3,opponent_score:0,conference_game:0,counts_for_record:1,
      source_type:"official-school",parser_type:"mascot-media",data_trust:"SINGLE_SOURCE_LIVE"
    },
    {
      id:"school-jamboree",team_id:"conway-volleyball-2026",school_id:"conway",opponent:"Jamboree",opponent_school_id:null,
      scheduled_at:"2026-08-20T17:00:00.000Z",status:"FINAL",team_score:2,opponent_score:0,conference_game:0,counts_for_record:1,
      source_type:"official-school",parser_type:"mascot-media",data_trust:"SINGLE_SOURCE_LIVE"
    }
  ];

  const built = buildRecordsFromInputs({teams,canonicals,raw});
  assert.equal(built.length,1);
  assert.deepEqual(built[0].record,{
    wins:2,losses:1,ties:0,
    conference_wins:0,conference_losses:1,conference_ties:0,
    scored_finals:3
  });
});

test("record rebuild excludes exhibition/non-record finals", () => {
  const teams=[{id:"valley-volleyball-2026",school_id:"valley",sport:"volleyball",gender:"girls",season:"2026",conference_id:null}];
  const canonicals=[{
    id:"ce-exhibition",reporting_team_id:"valley-volleyball-2026",sport:"volleyball",gender:"girls",season:"2026",home_school_id:"valley",away_school_id:"other",
    home_name:"Valley Springs High School",away_name:"Other High School",scheduled_at:"2026-08-15T23:00:00.000Z",
    status:"FINAL",home_score:3,away_score:0,conference_game:0,counts_for_record:0,trust_state:"CORROBORATED"
  }];
  const [built]=buildRecordsFromInputs({teams,canonicals,raw:[]});
  assert.equal(built.record.wins,0);
  assert.equal(built.record.scored_finals,0);
});

test("a canonical final involving the school does not count without membership for that exact team", () => {
  const teams=[{id:"jacksonville-volleyball-2026",school_id:"jacksonville",sport:"volleyball",gender:"girls",season:"2026",conference_id:null}];
  const canonicals=[{
    id:"ce-ghost",reporting_team_id:"opponent-volleyball-2026",sport:"volleyball",gender:"girls",season:"2026",
    home_school_id:"opponent",away_school_id:"jacksonville",home_name:"Opponent High School",away_name:"Jacksonville High School",
    scheduled_at:"2026-08-28T23:00:00.000Z",status:"FINAL",home_score:3,away_score:0,conference_game:0,counts_for_record:1,trust_state:"CORROBORATED"
  }];
  const [built]=buildRecordsFromInputs({teams,canonicals,raw:[]});
  assert.equal(built.candidates.length,0);
  assert.deepEqual(built.record,{
    wins:0,losses:0,ties:0,
    conference_wins:0,conference_losses:0,conference_ties:0,
    scored_finals:0
  });
});
