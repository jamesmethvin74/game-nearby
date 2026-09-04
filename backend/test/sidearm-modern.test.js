import test from "node:test";
import assert from "node:assert/strict";
import { normalizeModernSidearmHtml } from "../src/sidearm-modern.js";

const soccer={season:"2026",sport:"soccer",gender:"women",timezone:"America/Chicago",home_venue:"Coleman Sports Complex",home_latitude:34.725,home_longitude:-92.34};

function row({date="Aug 13",divider="vs.",opponent="ULM",location="Little Rock, Ark. / Coleman Sports Complex",result="T 1-1",promo="",id="7032",modifier=""}={}){
  return `<table><tbody><tr class="schedule-table-item ${modifier}">
    <th><time>Thu</time><time class="schedule-event-date__day">${date}</time></th>
    <td><strong class="schedule-event-item__divider">${divider}</strong><div class="schedule-event-item__team-content">${promo?`<strong class="schedule-event-item__promo-title"><strong><span>${promo}</span></strong></strong>`:""}<strong class="schedule-event-item__opponent-name">${opponent}</strong></div></td>
    <td><span class="schedule-event-location schedule-table-item__location">${location}</span></td>
    <td><div class="schedule-table-item__results"><div class="schedule-event-item-result"><div class="schedule-event-item-result__wrapper"><div class="schedule-event-item-result__label">${result}</div></div></div></div></td>
    <td><div class="schedule-event-item__dashboard-link" entity-id="${id}" entity-name="schedule-events"></div></td>
  </tr></tbody></table>`;
}

test("modern Sidearm parser reads Little Rock final tie",()=>{
  const [game]=normalizeModernSidearmHtml(row(),soccer);
  assert.equal(game.opponent,"ULM");
  assert.equal(game.homeAway,"home");
  assert.equal(game.status,"FINAL");
  assert.equal(game.result,"T");
  assert.equal(game.teamScore,1);
  assert.equal(game.opponentScore,1);
  assert.equal(game.sourceEventKey,"native:7032");
});

test("modern Sidearm parser reads away win and does not assign home coordinates",()=>{
  const [game]=normalizeModernSidearmHtml(row({date:"Aug 16",divider:"at",opponent:"Arkansas State",location:"Jonesboro, Ark. / A-State Soccer Park",result:"W 2-1",id:"7038"}),soccer);
  assert.equal(game.homeAway,"away");
  assert.equal(game.status,"FINAL");
  assert.equal(game.result,"W");
  assert.equal(game.latitude,null);
});

test("modern Sidearm parser treats exhibition and closed scrimmage as non-record games",()=>{
  const exhibition=normalizeModernSidearmHtml(row({date:"Aug 5",opponent:"Jackson State",result:"1:00 PM CDT",promo:"EXHIBITION",id:"10115"}),soccer)[0];
  assert.equal(exhibition.status,"SCHEDULED");
  assert.equal(exhibition.scheduledTimeKnown,true);
  assert.equal(exhibition.countsForRecord,0);

  const basketball={...soccer,sport:"basketball",gender:"women",home_venue:"Jack Stephens Center"};
  const scrimmage=normalizeModernSidearmHtml(row({date:"Oct 11",divider:"at",opponent:"Louisiana Tech",result:"TBA",promo:"Closed Scrimmage",id:"10210"}),basketball)[0];
  assert.equal(scrimmage.scheduledTimeKnown,false);
  assert.equal(scrimmage.countsForRecord,0);
});

test("modern Sidearm basketball dates in January roll into the next calendar year",()=>{
  const basketball={...soccer,sport:"basketball",gender:"men",home_venue:"Jack Stephens Center"};
  const [game]=normalizeModernSidearmHtml(row({date:"Jan 9",opponent:"UT Arlington",result:"7:00 PM CST",id:"11001"}),basketball);
  assert.match(game.scheduledAt,/^2027-01-10T01:00:00\.000Z$/);
});

test("modern Sidearm parser honors an explicit neutral modifier",()=>{
  const [game]=normalizeModernSidearmHtml(row({divider:"vs.",opponent:"Houston Christian",location:"Ruston, La. / Thomas Assembly Center",result:"W 3-2",modifier:"schedule-table-item--neutral"}),soccer);
  assert.equal(game.homeAway,"neutral");
  assert.equal(game.latitude,null);
});
