import test from "node:test";
import assert from "node:assert/strict";
import { matchLocalVolleyballTeams, matchDateFromUrl, maxPrepsScoresUrl, parseMaxPrepsVolleyballScores } from "../src/maxpreps-volleyball-results.js";

const options=`
<select id="q_n_teams">
  <option value="b3i3gpABj0eTqJfNrCI3Rw">Bergman</option>
  <option value="rodllMNpDkWVbWyCVle9GA">Flippin</option>
  <option value="zYq0zGR3Fkq0D8MQ9-aC8w">Cotter</option>
</select>`;

const bergman=`<li class="c" data-teams="b3i3gpABj0eTqJfNrCI3Rw,rodllMNpDkWVbWyCVle9GA" data-ri="0" data-contest-id="f5f278ae-d2e1-4016-b349-0e855bd0a838"><div class="contest-box-item" data-contest-state="boxscore"><a href="https://www.maxpreps.com/ar/volleyball/match/bergman-vs-flippin/8-27-2026/?c=f5f278ae-d2e1-4016-b349-0e855bd0a838" class="c-c"><ul class="teams"><li data-result="2" class="winner"><div class="score">3</div><div class="name">Flippin</div></li><li data-result="3"><div class="score">2</div><div class="name">Bergman</div></li></ul><div class="details"> Final</div></a></div></li>`;
const cotter=`<li class="c" data-teams="zYq0zGR3Fkq0D8MQ9-aC8w,rodllMNpDkWVbWyCVle9GA" data-ri="0" data-contest-id="8c531348-9e1a-4661-8af5-babfeb264821"><div class="contest-box-item" data-contest-state="boxscore"><a href="https://www.maxpreps.com/ar/volleyball/match/cotter-vs-flippin/8-29-2026/?c=8c531348-9e1a-4661-8af5-babfeb264821" class="c-c"><ul class="teams"><li data-result="3"><div class="score">0</div><div class="name">Flippin</div></li><li data-result="2" class="winner"><div class="score">2</div><div class="name"><span class="rank">(#20)</span> Cotter</div></li></ul><div class="details"> Final</div></a></div></li>`;

test("parses only final score cards whose match URL date matches the requested score date",()=>{
  const html=`${options}<ul>${bergman}${cotter}</ul>`;
  const finals=parseMaxPrepsVolleyballScores(html,{localDate:"2026-08-29"});
  assert.equal(finals.length,1);
  assert.deepEqual(finals[0].home,{maxprepsId:"zYq0zGR3Fkq0D8MQ9-aC8w",name:"Cotter",score:2});
  assert.deepEqual(finals[0].away,{maxprepsId:"rodllMNpDkWVbWyCVle9GA",name:"Flippin",score:0});
});

test("rejects replayed current-day finals from a historical date request",()=>{
  const septemberReplay=bergman.replace("8-27-2026","9-10-2026");
  const finals=parseMaxPrepsVolleyballScores(`${options}<ul>${septemberReplay}</ul>`,{localDate:"2026-08-01"});
  assert.deepEqual(finals,[]);
});

test("extracts the authoritative local match date from MaxPreps event URLs",()=>{
  assert.equal(matchDateFromUrl("https://www.maxpreps.com/ar/volleyball/match/a-vs-b/9-10-2026/?c=x"),"2026-09-10");
  assert.equal(matchDateFromUrl("https://www.maxpreps.com/inter-state/volleyball/match/a-ar-vs-b-la/8-29-2026/?c=x"),"2026-08-29");
  assert.equal(matchDateFromUrl("https://www.maxpreps.com/ar/volleyball/scores/"),null);
});

test("maps unique score-card schools onto existing local varsity volleyball teams",()=>{
  const finals=parseMaxPrepsVolleyballScores(`${options}<ul>${cotter}</ul>`,{localDate:"2026-08-29"});
  const localTeams=[
    {team_id:"flippin-volleyball-2026",school_id:"flippin",school_name:"Flippin High School"},
    {team_id:"cotter-volleyball-2026",school_id:"cotter",school_name:"Cotter High School"}
  ];
  const result=matchLocalVolleyballTeams(finals,localTeams);
  assert.equal(result.matched.length,1);
  assert.equal(result.oneSided.length,0);
  assert.equal(result.ambiguous.length,0);
  assert.equal(result.matched[0].homeTeam.team_id,"cotter-volleyball-2026");
  assert.equal(result.matched[0].awayTeam.team_id,"flippin-volleyball-2026");
});

test("returns a one-sided final when exactly one Arkansas local team resolves uniquely",()=>{
  const finals=[{
    contestId:"one-sided-1",
    localDate:"2026-08-30",
    sourceUrl:"https://www.maxpreps.com/ar/volleyball/scores/",
    home:{maxprepsId:"local-id",name:"Flippin",score:3},
    away:{maxprepsId:"external-id",name:"Missouri Academy",score:1}
  }];
  const localTeams=[{team_id:"flippin-volleyball-2026",school_id:"flippin",school_name:"Flippin High School"}];
  const result=matchLocalVolleyballTeams(finals,localTeams);
  assert.equal(result.matched.length,0);
  assert.equal(result.oneSided.length,1);
  assert.equal(result.ambiguous.length,0);
  assert.equal(result.oneSided[0].homeTeam.team_id,"flippin-volleyball-2026");
  assert.equal(result.oneSided[0].awayTeam,null);
  assert.equal(result.oneSided[0].unresolvedSide,"away");
});

test("skips ambiguous school names rather than guessing",()=>{
  const finals=parseMaxPrepsVolleyballScores(`${options}<ul>${cotter}</ul>`,{localDate:"2026-08-29"});
  const localTeams=[
    {team_id:"flippin-volleyball-2026",school_id:"flippin",school_name:"Flippin High School"},
    {team_id:"cotter-a",school_id:"cotter-a",school_name:"Cotter High School"},
    {team_id:"cotter-b",school_id:"cotter-b",school_name:"Cotter"}
  ];
  const result=matchLocalVolleyballTeams(finals,localTeams);
  assert.equal(result.matched.length,0);
  assert.equal(result.oneSided.length,0);
  assert.equal(result.ambiguous.length,1);
});

test("builds date-bounded Arkansas volleyball score URL",()=>{
  assert.equal(maxPrepsScoresUrl("2026-08-27"),"https://www.maxpreps.com/ar/volleyball/scores/?date=8%2F27%2F2026");
});
