import test from "node:test";
import assert from "node:assert/strict";
import { STATEWIDE_MEMBERSHIP_SOURCES,parseCurrentConferenceLinks } from "../src/statewide-conference-membership-source.js";
import {
  normalizeMembershipSourceSchoolName,
  highSchoolMembershipIdentityOverride,
  isKnownMembershipSourceGap
} from "../src/m9-high-school-membership-identity.js";

test("M9 covers all six high-school sport/gender conference surfaces",()=>{
  assert.deepEqual(STATEWIDE_MEMBERSHIP_SOURCES.map(row=>row.key),[
    "football-boys","volleyball-girls","basketball-boys","basketball-girls","soccer-boys","soccer-girls"
  ]);
  assert.equal(new Set(STATEWIDE_MEMBERSHIP_SOURCES.map(row=>`${row.sport}|${row.gender}`)).size,6);
});

test("current conference parser is season and gender path scoped",()=>{
  const girls=STATEWIDE_MEMBERSHIP_SOURCES.find(row=>row.key==="basketball-girls");
  const html=`
    <a href="/ar/basketball/girls/26-27/conference/5a-central/?leagueid=abc">5A Central</a>
    <a href="/ar/basketball/26-27/conference/5a-central/">boys</a>
    <a href="/ar/basketball/girls/25-26/conference/5a-central/">old</a>`;
  const rows=parseCurrentConferenceLinks(html,girls);
  assert.equal(rows.length,1);
  assert.equal(rows[0].id,"5a-central");
  assert.equal(rows[0].name,"5A Central");
});

test("soccer paths use the spring 26-27 namespace",()=>{
  const girls=STATEWIDE_MEMBERSHIP_SOURCES.find(row=>row.key==="soccer-girls");
  const rows=parseCurrentConferenceLinks(`<a href="/ar/soccer/girls/spring/26-27/conference/6a-central/">6A Central</a>`,girls);
  assert.equal(rows[0].id,"6a-central");
});

test("M9 normalizes provider presentation noise without fuzzy school matching",()=>{
  assert.equal(normalizeMembershipSourceSchoolName("N Norfork"),"Norfork");
  assert.equal(normalizeMembershipSourceSchoolName("Crowley&#x27;s Ridge Academy"),"Crowley's Ridge Academy");
  assert.equal(normalizeMembershipSourceSchoolName("West Fork"),"West Fork");
});

test("M9 duplicate-name schools require source and conference exact overrides",()=>{
  const volleyball={key:"volleyball-girls"};
  assert.equal(highSchoolMembershipIdentityOverride(volleyball,{id:"5a-south"},"Lakeside"),"df-vt4unv");
  assert.equal(highSchoolMembershipIdentityOverride(volleyball,{id:"3a-6"},"Harmony Grove"),"df-3wa5q2");
  assert.equal(highSchoolMembershipIdentityOverride({key:"soccer-boys"},{id:"6a-central"},"Little Rock Central"),"df-t2mq54");
});

test("only the observed empty boys 4A Region 6 roster is a known source gap",()=>{
  assert.equal(isKnownMembershipSourceGap("basketball-boys","4a-region-6"),true);
  assert.equal(isKnownMembershipSourceGap("basketball-girls","4a-region-6"),false);
  assert.equal(isKnownMembershipSourceGap("basketball-boys","5a-central"),false);
});
