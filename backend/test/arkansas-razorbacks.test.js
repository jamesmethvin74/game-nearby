import test from "node:test";
import assert from "node:assert/strict";
import { arkansasRazorbackScheduleUrl, normalizeArkansasRazorbackHtml } from "../src/arkansas-razorbacks.js";

const footballSource = {
  season:"2026", sport:"football", gender:"men", timezone:"America/Chicago",
  home_venue:"Donald W. Reynolds Razorback Stadium", home_latitude:36.0686, home_longitude:-94.1789
};

function item({type="Home",date="Sat. Sep. 5",time="3:15 PM",place="Fayetteville, Ark.",opponent="North Alabama",result=""}={}) {
  return `<div class="item"><div class="content"><div class="blocks">
    <div class="time-container"><div class="type ${type.toLowerCase()}">${type}</div><div class="date"><span class="month">${date}</span><span class="time">${time}</span></div><div class="place">${place}</div></div>
    <div class="opponent-container"><div class="opponent"><span>${opponent}</span></div></div>
    <div class="results-container">${result}</div>
  </div></div></div>`;
}

test("Arkansas parser reads the captured official home-game markup", () => {
  const [game] = normalizeArkansasRazorbackHtml(`<section class="events">${item()}</section>`, footballSource);
  assert.equal(game.opponent,"North Alabama");
  assert.equal(game.homeAway,"home");
  assert.equal(game.venue,"Fayetteville, Ark.");
  assert.equal(game.status,"SCHEDULED");
  assert.equal(game.scheduledTimeKnown,true);
  assert.equal(game.latitude,36.0686);
  assert.equal(game.longitude,-94.1789);
});

test("Arkansas parser reads away finals and strips the display relation", () => {
  const [game] = normalizeArkansasRazorbackHtml(`<section class="events">${item({type:"Away",date:"Sat. Sep. 12",time:"9:15 PM",place:"Salt Lake City, Utah",opponent:"at Utah",result:"L, 31-24"})}</section>`, footballSource);
  assert.equal(game.opponent,"Utah");
  assert.equal(game.homeAway,"away");
  assert.equal(game.status,"FINAL");
  assert.equal(game.result,"L");
  assert.equal(game.teamScore,31);
  assert.equal(game.opponentScore,24);
  assert.equal(game.latitude,null);
});

test("Arkansas parser keeps TBA games while marking the clock unknown", () => {
  const basketball = {...footballSource,sport:"basketball",gender:"women",home_venue:"Bud Walton Arena"};
  const [game] = normalizeArkansasRazorbackHtml(`<section class="events">${item({date:"Sun. Jan. 3",time:"TBA",place:"Bud Walton Arena",opponent:"Florida"})}</section>`, basketball);
  assert.equal(game.scheduledTimeKnown,false);
  assert.match(game.scheduledAt,/^2027-01-03T/);
});

test("Arkansas parser excludes exhibitions from record math", () => {
  const basketball = {...footballSource,sport:"basketball",gender:"men"};
  const [game] = normalizeArkansasRazorbackHtml(`<section class="events">${item({type:"Neutral",date:"Fri. Jul. 31",time:"6:00 PM",place:"Nassau, The Bahamas",opponent:"vs The Bahamas National Team (Exhibition)",result:"W, 106-59"})}</section>`, basketball);
  assert.equal(game.homeAway,"neutral");
  assert.equal(game.countsForRecord,0);
  assert.equal(game.status,"FINAL");
});

test("Arkansas source URLs cover all five M3 supported Razorback targets", () => {
  const targets = [
    [{sport:"football",gender:"men"},"/sport/m-footbl/schedule/"],
    [{sport:"basketball",gender:"men"},"/sport/m-baskbl/schedule/"],
    [{sport:"basketball",gender:"women"},"/sport/w-baskbl/schedule/"],
    [{sport:"soccer",gender:"women"},"/sport/w-soccer/schedule/"],
    [{sport:"volleyball",gender:"women"},"/sport/w-volley/schedule/"]
  ];
  for (const [team,path] of targets) assert.equal(arkansasRazorbackScheduleUrl(team),`https://arkansasrazorbacks.com${path}`);
});
