import test from "node:test";
import assert from "node:assert/strict";
import { matchLocalVolleyballTeams, parseMaxPrepsVolleyballScores } from "../src/maxpreps-volleyball-results.js";

test("MaxPreps parser decodes hexadecimal numeric entities in school names",()=>{
  const html=`
    <select><option value="a">Crowley&#x27;s Ridge Academy</option><option value="b">Flippin</option></select>
    <ul><li class="c" data-teams="a,b" data-contest-id="entity-final"><a class="c-c" href="/ar/volleyball/match/test/?c=entity-final"><ul class="teams">
      <li class="winner"><div class="score">3</div><div class="name">Crowley&#x27;s Ridge Academy</div></li>
      <li><div class="score">1</div><div class="name">Flippin</div></li>
    </ul><div class="details">Final</div></a></li></ul>`;
  const finals=parseMaxPrepsVolleyballScores(html,{localDate:"2026-08-18"});
  assert.equal(finals.length,1);
  assert.equal(finals[0].home.name,"Crowley's Ridge Academy");
});

test("MaxPreps matcher treats Senior High and base school names as the same local team",()=>{
  const finals=[{
    contestId:"morrilton-final",localDate:"2026-08-18",sourceUrl:"https://www.maxpreps.com/ar/volleyball/scores/",
    home:{maxprepsId:"morrilton-id",name:"Morrilton",score:3},
    away:{maxprepsId:"atkins-id",name:"Atkins",score:0}
  }];
  const localTeams=[
    {team_id:"morrilton-volleyball-2026",school_id:"morrilton",school_name:"Morrilton Senior High School"},
    {team_id:"atkins-volleyball-2026",school_id:"atkins",school_name:"Atkins High School"}
  ];
  const result=matchLocalVolleyballTeams(finals,localTeams);
  assert.equal(result.matched.length,1);
  assert.equal(result.oneSided.length,0);
  assert.equal(result.matched[0].homeTeam.team_id,"morrilton-volleyball-2026");
});

test("multiple aliases from one team do not create artificial ambiguity",()=>{
  const finals=[{
    contestId:"alias-final",localDate:"2026-08-18",sourceUrl:"https://www.maxpreps.com/ar/volleyball/scores/",
    home:{maxprepsId:"a",name:"Morrilton",score:3},away:{maxprepsId:"b",name:"Atkins",score:0}
  }];
  const localTeams=[
    {team_id:"morrilton-volleyball-2026",school_id:"morrilton",school_name:"Morrilton Senior High School",raw_school_name:"Morrilton High School",location_matched_name:"Morrilton Senior High School"},
    {team_id:"atkins-volleyball-2026",school_id:"atkins",school_name:"Atkins High School"}
  ];
  const result=matchLocalVolleyballTeams(finals,localTeams);
  assert.equal(result.matched.length,1);
  assert.equal(result.ambiguous.length,0);
});
