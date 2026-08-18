// Conway-area school expansion. Loaded after app.js so the base UI stays simple.
const SCHOOL_REGISTRY = [
  {id:"conway",name:"Conway High School",subtitle:"Wampus Cats",short:"C"},
  {id:"uca",name:"University of Central Arkansas",subtitle:"Bears / Sugar Bears",short:"UCA"},
  {id:"hendrix",name:"Hendrix College",subtitle:"Warriors",short:"H"},
  {id:"cbc",name:"Central Baptist College",subtitle:"Mustangs",short:"CBC"},
  {id:"greenbrier",name:"Greenbrier High School",subtitle:"Panthers",short:"G"},
  {id:"vilonia",name:"Vilonia High School",subtitle:"Eagles",short:"V"},
  {id:"mayflower",name:"Mayflower High School",subtitle:"Eagles",short:"M"},
  {id:"maumelle",name:"Maumelle High School",subtitle:"Hornets",short:"MHS"}
];

for (const school of SCHOOL_REGISTRY) {
  const existing = teams.find(t => t.id === school.id);
  if (existing) Object.assign(existing, {name: school.name, short: school.short});
  else teams.push({id: school.id, name: school.name, short: school.short});
}

const LOCAL = {
  uca:{lat:35.0809,lon:-92.4590,venue:"UCA"},
  estes:{lat:35.0779,lon:-92.4574,venue:"Estes Stadium"},
  prince:{lat:35.0817,lon:-92.4576,venue:"Prince Center"},
  ucaSoccer:{lat:35.0767,lon:-92.4545,venue:"Bill Stephens Track/Soccer Complex"},
  hendrix:{lat:35.0997,lon:-92.4426,venue:"Hendrix College"},
  youngWise:{lat:35.1020,lon:-92.4412,venue:"Young-Wise Memorial Stadium"},
  grove:{lat:35.0995,lon:-92.4432,venue:"Grove Gymnasium"},
  warriorSoccer:{lat:35.1018,lon:-92.4450,venue:"Warrior Soccer Field"},
  greenbrier:{lat:35.2334,lon:-92.3870,venue:"Greenbrier High School"},
  vilonia:{lat:35.0839,lon:-92.2029,venue:"Vilonia High School"},
  mayflower:{lat:34.9679,lon:-92.4274,venue:"Mayflower High School"},
  maumelle:{lat:34.8529,lon:-92.4043,venue:"Maumelle High School"},
  beebe:{lat:35.0706,lon:-91.8854,venue:"Beebe High School"},
  morrilton:{lat:35.1509,lon:-92.7430,venue:"Morrilton High School"},
  littleRock:{lat:34.7465,lon:-92.2896,venue:"Little Rock"},
  nlr:{lat:34.7695,lon:-92.2671,venue:"North Little Rock"},
  bryant:{lat:34.5959,lon:-92.4890,venue:"Bryant High School"},
  hotSprings:{lat:34.5037,lon:-93.0552,venue:"Hot Springs"},
  jacksonville:{lat:34.8662,lon:-92.1101,venue:"Jacksonville"},
  clarksville:{lat:35.4715,lon:-93.4666,venue:"Clarksville"},
  batesville:{lat:35.7698,lon:-91.6409,venue:"Batesville"},
  memphis:{lat:35.1495,lon:-90.0490,venue:"Memphis, TN"},
  tulsa:{lat:36.1540,lon:-95.9928,venue:"Tulsa, OK"},
  jonesboro:{lat:35.8423,lon:-90.7043,venue:"Jonesboro"},
  springfield:{lat:37.2090,lon:-93.2923,venue:"Springfield, MO"},
  capeGirardeau:{lat:37.3059,lon:-89.5181,venue:"Cape Girardeau, MO"}
};

const SRC = {
  ucaFootball:"https://ucasports.com/sports/football/schedule/2026",
  ucaVolleyball:"https://ucasports.com/sports/womens-volleyball/schedule/2026",
  ucaWomensSoccer:"https://ucasports.com/sports/womens-soccer/schedule/2026",
  hendrixFootball:"https://hendrixwarriors.com/sports/football/schedule/2026",
  hendrixVolleyball:"https://hendrixwarriors.com/sports/womens-volleyball/schedule/2026",
  hendrixWomensSoccer:"https://hendrixwarriors.com/sports/womens-soccer/schedule/2026",
  greenbrierFootball:"https://www.maxpreps.com/ar/greenbrier/greenbrier-panthers/football/schedule/",
  greenbrierVolleyball:"https://www.maxpreps.com/ar/greenbrier/greenbrier-panthers/volleyball/schedule/",
  viloniaFootball:"https://www.maxpreps.com/ar/vilonia/vilonia-eagles/football/schedule/",
  mayflowerFootball:"https://www.maxpreps.com/ar/mayflower/mayflower-eagles/football/schedule/",
  maumelleFootball:"https://www.maxpreps.com/ar/maumelle/maumelle-hornets/football/schedule/"
};

function addSchoolEvent({id,schoolId,team,sport,gender="",level,opponent,date,home=true,loc,venue,source="official",sourceUrl,ticketUrl="",notes=""}) {
  const p = loc || LOCAL[schoolId] || LOC.conway;
  events.push({id,teamId:schoolId,team,sport,gender,level,opponent,date,home,lat:p.lat,lon:p.lon,venue:venue||p.venue,source,sourceUrl,ticketUrl,notes});
}

// UCA FOOTBALL — official 2026 schedule.
[
 ["uca-fb-0827","UT Martin","2026-08-27T18:30:00-05:00",false,null,"Martin, TN"],
 ["uca-fb-0905","West Florida","2026-09-05T18:00:00-05:00",true,LOCAL.estes],
 ["uca-fb-0912","Central Oklahoma","2026-09-12T18:00:00-05:00",true,LOCAL.estes],
 ["uca-fb-0919","Southeast Missouri State","2026-09-19T18:00:00-05:00",false,LOCAL.capeGirardeau],
 ["uca-fb-0926","Florida State","2026-09-26T12:00:00-05:00",false,null,"Tallahassee, FL"],
 ["uca-fb-1010","Abilene Christian","2026-10-10T19:00:00-05:00",false,null,"Abilene, TX"],
 ["uca-fb-1017","Tarleton State","2026-10-17T18:00:00-05:00",false,null,"Stephenville, TX"],
 ["uca-fb-1024","UT Rio Grande Valley","2026-10-24T16:00:00-05:00",true,LOCAL.estes],
 ["uca-fb-1031","North Alabama","2026-10-31T16:00:00-05:00",true,LOCAL.estes],
 ["uca-fb-1107","West Georgia","2026-11-07T16:00:00-06:00",true,LOCAL.estes],
 ["uca-fb-1114","Eastern Kentucky","2026-11-14T13:00:00-06:00",false,null,"Richmond, KY"],
 ["uca-fb-1121","Austin Peay","2026-11-21T16:00:00-06:00",true,LOCAL.estes]
].forEach(([id,opp,date,home,loc,venue])=>addSchoolEvent({id,schoolId:"uca",team:"UCA Bears",sport:"football",gender:"men",level:"college",opponent:opp,date,home,loc,venue,sourceUrl:SRC.ucaFootball}));

// UCA VOLLEYBALL — published 2026 events currently visible on official schedule.
[
 ["uca-vb-0818","Arkansas Tech","2026-08-18T15:00:00-05:00",true,LOCAL.prince,"Exhibition"],
 ["uca-vb-0820","Purple & Gray Scrimmage","2026-08-20T18:00:00-05:00",true,LOCAL.prince,"Scrimmage"],
 ["uca-vb-0822","Missouri State","2026-08-22T12:00:00-05:00",true,LOCAL.prince,"Exhibition"],
 ["uca-vb-0828","Denver","2026-08-28T16:00:00-05:00",false,null,"Boulder, CO"],
 ["uca-vb-0829","Colorado","2026-08-29T19:00:00-05:00",false,null,"Boulder, CO"],
 ["uca-vb-0830","CSUN","2026-08-30T12:00:00-05:00",false,null,"Boulder, CO"],
 ["uca-vb-0905","Southern Miss","2026-09-05T12:00:00-05:00",false,null,"Oxford, MS"],
 ["uca-vb-0906","Ole Miss","2026-09-06T12:00:00-05:00",false,null,"Oxford, MS"]
].forEach(([id,opp,date,home,loc,venueOrNotes])=>addSchoolEvent({id,schoolId:"uca",team:"UCA Sugar Bears",sport:"volleyball",gender:"women",level:"college",opponent:opp,date,home,loc,venue:loc?undefined:venueOrNotes,notes:loc?venueOrNotes:"",sourceUrl:SRC.ucaVolleyball}));

// UCA WOMEN'S SOCCER — official 2026 schedule, Conway-area/home plus regionally relevant events.
[
 ["uca-ws-0823","Arkansas State","2026-08-23T16:00:00-05:00",false,LOCAL.jonesboro],
 ["uca-ws-0827","Alabama State","2026-08-27T19:00:00-05:00",true,LOCAL.ucaSoccer],
 ["uca-ws-0830","Missouri State","2026-08-30T13:00:00-05:00",false,LOCAL.springfield],
 ["uca-ws-0906","UT Martin","2026-09-06T19:00:00-05:00",true,LOCAL.ucaSoccer],
 ["uca-ws-0910","Nevada","2026-09-10T19:00:00-05:00",true,LOCAL.ucaSoccer],
 ["uca-ws-0924","Tarleton State","2026-09-24T19:00:00-05:00",true,LOCAL.ucaSoccer],
 ["uca-ws-0927","Little Rock","2026-09-27T19:00:00-05:00",true,LOCAL.ucaSoccer],
 ["uca-ws-1015","Austin Peay","2026-10-15T19:00:00-05:00",true,LOCAL.ucaSoccer],
 ["uca-ws-1018","North Alabama","2026-10-18T13:00:00-05:00",true,LOCAL.ucaSoccer],
 ["uca-ws-1025","Abilene Christian","2026-10-25T13:00:00-05:00",true,LOCAL.ucaSoccer],
 ["uca-ws-1029","Little Rock","2026-10-29T18:00:00-05:00",false,LOCAL.littleRock]
].forEach(([id,opp,date,home,loc])=>addSchoolEvent({id,schoolId:"uca",team:"UCA Bears",sport:"soccer",gender:"women",level:"college",opponent:opp,date,home,loc,sourceUrl:SRC.ucaWomensSoccer}));

// HENDRIX FOOTBALL — official 2026 schedule.
[
 ["hx-fb-0912","Huntingdon College","2026-09-12T13:00:00-05:00",true,LOCAL.youngWise],
 ["hx-fb-0919","Millsaps College","2026-09-19T13:00:00-05:00",false,null,"Jackson, MS"],
 ["hx-fb-0926","Austin College","2026-09-26T13:00:00-05:00",false,null,"Sherman, TX"],
 ["hx-fb-1003","Schreiner University","2026-10-03T18:00:00-05:00",false,null,"Kerrville, TX"],
 ["hx-fb-1010","Centenary College","2026-10-10T13:00:00-05:00",true,LOCAL.youngWise],
 ["hx-fb-1017","Texas Lutheran","2026-10-17T13:00:00-05:00",false,null,"Seguin, TX"],
 ["hx-fb-1024","Austin College","2026-10-24T13:00:00-05:00",true,LOCAL.youngWise],
 ["hx-fb-1031","Rhodes College","2026-10-31T18:00:00-05:00",false,LOCAL.memphis],
 ["hx-fb-1107","Lyon College","2026-11-07T13:00:00-06:00",false,LOCAL.batesville]
].forEach(([id,opp,date,home,loc,venue])=>addSchoolEvent({id,schoolId:"hendrix",team:"Hendrix Warriors",sport:"football",gender:"men",level:"college",opponent:opp,date,home,loc,venue,sourceUrl:SRC.hendrixFootball}));

// HENDRIX VOLLEYBALL — official 2026 schedule (home/local events plus full published slate where venue known).
[
 ["hx-vb-0925","University of the Ozarks","2026-09-25T18:00:00-05:00",false,LOCAL.clarksville],
 ["hx-vb-0926","LeTourneau University","2026-09-26T15:00:00-05:00",true,LOCAL.grove],
 ["hx-vb-1024a","Colorado College","2026-10-24T12:15:00-05:00",true,LOCAL.grove],
 ["hx-vb-1024b","University of Dallas","2026-10-24T18:30:00-05:00",true,LOCAL.grove],
 ["hx-vb-1030","Austin College","2026-10-30T18:00:00-05:00",true,LOCAL.grove],
 ["hx-vb-1031","Centenary College","2026-10-31T13:00:00-05:00",true,LOCAL.grove],
 ["hx-vb-1106","University of the Ozarks","2026-11-06T18:00:00-06:00",true,LOCAL.grove]
].forEach(([id,opp,date,home,loc])=>addSchoolEvent({id,schoolId:"hendrix",team:"Hendrix Warriors",sport:"volleyball",gender:"women",level:"college",opponent:opp,date,home,loc,sourceUrl:SRC.hendrixVolleyball}));

// HENDRIX WOMEN'S SOCCER — official 2026 Conway/home events.
[
 ["hx-ws-0901","Southwest Baptist","2026-09-01T19:00:00-05:00",true],
 ["hx-ws-0905","Belhaven","2026-09-05T11:30:00-05:00",true],
 ["hx-ws-0911","Rhodes College","2026-09-11T17:00:00-05:00",true],
 ["hx-ws-0912","Central Baptist College","2026-09-12T19:00:00-05:00",true],
 ["hx-ws-0916","Williams Baptist","2026-09-16T18:30:00-05:00",true],
 ["hx-ws-0923","Lyon College","2026-09-23T19:00:00-05:00",true],
 ["hx-ws-1004","University of Dallas","2026-10-04T13:30:00-05:00",true],
 ["hx-ws-1009","LeTourneau University","2026-10-09T17:30:00-05:00",true],
 ["hx-ws-1020","Champion Christian","2026-10-20T17:00:00-05:00",true]
].forEach(([id,opp,date,home])=>addSchoolEvent({id,schoolId:"hendrix",team:"Hendrix Warriors",sport:"soccer",gender:"women",level:"college",opponent:opp,date,home,loc:LOCAL.warriorSoccer,sourceUrl:SRC.hendrixWomensSoccer}));

// HIGH SCHOOL FALL SCHEDULES.
[
 ["gb-fb-0828","Hot Springs","2026-08-28T19:00:00-05:00",true,LOCAL.greenbrier],
 ["gb-fb-0911","Van Buren","2026-09-11T19:00:00-05:00",false,null,"Van Buren"],
 ["gb-fb-0925","Parkview","2026-09-25T19:00:00-05:00",true,LOCAL.greenbrier],
 ["gb-fb-1009","Jacksonville","2026-10-09T19:00:00-05:00",true,LOCAL.greenbrier],
 ["gb-fb-1016","Mills University Studies","2026-10-16T19:00:00-05:00",false,LOCAL.littleRock],
 ["gb-fb-1023","Robinson","2026-10-23T19:00:00-05:00",true,LOCAL.greenbrier],
 ["gb-fb-1030","Maumelle","2026-10-30T19:00:00-05:00",false,LOCAL.maumelle],
 ["gb-fb-1106","Vilonia","2026-11-06T19:00:00-06:00",false,LOCAL.vilonia]
].forEach(([id,opp,date,home,loc,venue])=>addSchoolEvent({id,schoolId:"greenbrier",team:"Greenbrier Panthers",sport:"football",gender:"boys",level:"high-school",opponent:opp,date,home,loc,venue,source:"secondary",sourceUrl:SRC.greenbrierFootball}));

[
 ["gb-vb-0825","Vilonia","2026-08-25T17:30:00-05:00",false,LOCAL.vilonia],
 ["gb-vb-0827","Jacksonville","2026-08-27T17:30:00-05:00",true,LOCAL.greenbrier],
 ["gb-vb-0915","Maumelle","2026-09-15T17:30:00-05:00",false,LOCAL.maumelle],
 ["gb-vb-0924","Vilonia","2026-09-24T18:00:00-05:00",true,LOCAL.greenbrier],
 ["gb-vb-0928","Conway","2026-09-28T17:30:00-05:00",true,LOCAL.greenbrier],
 ["gb-vb-1015","Maumelle","2026-10-15T17:30:00-05:00",true,LOCAL.greenbrier]
].forEach(([id,opp,date,home,loc])=>addSchoolEvent({id,schoolId:"greenbrier",team:"Greenbrier Panthers",sport:"volleyball",gender:"girls",level:"high-school",opponent:opp,date,home,loc,source:"secondary",sourceUrl:SRC.greenbrierVolleyball}));

[
 ["vi-fb-0828","Nettleton","2026-08-28T19:00:00-05:00",false,null,"Nettleton"],
 ["vi-fb-0904","Morrilton","2026-09-04T19:00:00-05:00",true,LOCAL.vilonia],
 ["vi-fb-0911","Alma","2026-09-11T19:00:00-05:00",false,null,"Alma"],
 ["vi-fb-0925","Beebe","2026-09-25T19:00:00-05:00",false,LOCAL.beebe],
 ["vi-fb-1002","Maumelle","2026-10-02T19:00:00-05:00",false,LOCAL.maumelle],
 ["vi-fb-1009","Robinson","2026-10-09T19:00:00-05:00",true,LOCAL.vilonia],
 ["vi-fb-1016","Jacksonville","2026-10-16T19:00:00-05:00",true,LOCAL.vilonia],
 ["vi-fb-1023","Mills University Studies","2026-10-23T19:00:00-05:00",false,LOCAL.littleRock],
 ["vi-fb-1030","Parkview","2026-10-30T19:00:00-05:00",true,LOCAL.vilonia],
 ["vi-fb-1106","Greenbrier","2026-11-06T19:00:00-06:00",true,LOCAL.vilonia]
].forEach(([id,opp,date,home,loc,venue])=>addSchoolEvent({id,schoolId:"vilonia",team:"Vilonia Eagles",sport:"football",gender:"boys",level:"high-school",opponent:opp,date,home,loc,venue,source:"secondary",sourceUrl:SRC.viloniaFootball}));

[
 ["mf-fb-0828","Beebe","2026-08-28T19:00:00-05:00",true,LOCAL.mayflower],
 ["mf-fb-0904","Hope","2026-09-04T19:00:00-05:00",false,null,"Hope"],
 ["mf-fb-0911","Huntsville","2026-09-11T19:00:00-05:00",false,null,"Huntsville"],
 ["mf-fb-0925","Clinton","2026-09-25T19:00:00-05:00",false,null,"Clinton"],
 ["mf-fb-1002","Bauxite","2026-10-02T19:00:00-05:00",false,null,"Bauxite"],
 ["mf-fb-1016","Heber Springs","2026-10-16T19:00:00-05:00",false,null,"Heber Springs"],
 ["mf-fb-1023","Harmony Grove","2026-10-23T19:00:00-05:00",true,LOCAL.mayflower],
 ["mf-fb-1030","Lonoke","2026-10-30T19:00:00-05:00",false,null,"Lonoke"],
 ["mf-fb-1106","Bald Knob","2026-11-06T19:00:00-06:00",true,LOCAL.mayflower]
].forEach(([id,opp,date,home,loc,venue])=>addSchoolEvent({id,schoolId:"mayflower",team:"Mayflower Eagles",sport:"football",gender:"boys",level:"high-school",opponent:opp,date,home,loc,venue,source:"secondary",sourceUrl:SRC.mayflowerFootball}));

[
 ["mm-fb-0828","Ozark","2026-08-28T19:00:00-05:00",true,LOCAL.maumelle],
 ["mm-fb-0904","Sylvan Hills","2026-09-04T19:00:00-05:00",false,LOCAL.nlr],
 ["mm-fb-0911","Hot Springs","2026-09-11T19:00:00-05:00",false,LOCAL.hotSprings],
 ["mm-fb-0925","Mills University Studies","2026-09-25T19:00:00-05:00",false,LOCAL.littleRock],
 ["mm-fb-1002","Vilonia","2026-10-02T19:00:00-05:00",true,LOCAL.maumelle],
 ["mm-fb-1008","Parkview","2026-10-08T19:00:00-05:00",false,LOCAL.littleRock],
 ["mm-fb-1016","Beebe","2026-10-16T19:00:00-05:00",false,LOCAL.beebe],
 ["mm-fb-1023","Jacksonville","2026-10-23T19:00:00-05:00",true,LOCAL.maumelle],
 ["mm-fb-1030","Greenbrier","2026-10-30T19:00:00-05:00",true,LOCAL.maumelle],
 ["mm-fb-1105","Robinson","2026-11-05T19:00:00-06:00",true,LOCAL.maumelle]
].forEach(([id,opp,date,home,loc])=>addSchoolEvent({id,schoolId:"maumelle",team:"Maumelle Hornets",sport:"football",gender:"boys",level:"high-school",opponent:opp,date,home,loc,source:"secondary",sourceUrl:SRC.maumelleFootball}));

// School-centric picker.
renderTeamChoices = function() {
  teamChoicesEl.innerHTML = SCHOOL_REGISTRY.map(school => {
    const count = events.filter(e => e.teamId === school.id && isUpcoming(e)).length;
    return `<label class="team-choice"><span><strong>${school.name}</strong><small style="display:block;color:var(--muted);margin-top:3px">${school.subtitle} · ${count} upcoming event${count===1?"":"s"}</small></span><input type="checkbox" value="${school.id}" ${followed.includes(school.id)?"checked":""}></label>`;
  }).join("");
};

// Replace card renderer so ticket links are school/event-specific rather than Conway-only.
eventCard = function(event,priority=false) {
  const dist=haversineMiles(center,event);
  const matchup=`${event.home?"vs.":"at"} ${event.opponent}`;
  const locationClass=event.home?"home-game":"away-game";
  const locationLabel=event.home?"HOME":"AWAY";
  const sourceText=event.source==="official"?"Official schedule":"Schedule source";
  const tickets=event.ticketUrl?`<a class="ticket-action" href="${event.ticketUrl}" target="_blank" rel="noopener">Tickets</a>`:"";
  return `<article class="event-card ${priority?"priority":""} ${locationClass}"><div class="event-main"><div class="team-badge">${badgeFor(event.teamId)}</div><div><div class="event-title">${event.team}</div><span class="home-away-badge">${locationLabel}</span><div>${event.gender?capitalize(event.gender)+" ":""}${capitalize(event.sport)} · ${matchup}</div><div class="event-meta">${formatEventDate(event.date)} · ${event.venue}${event.notes?` · ${event.notes}`:""}</div><div class="event-meta"><a href="${event.sourceUrl}" target="_blank" rel="noopener">${sourceText}</a></div></div><div class="distance">${dist.toFixed(1)} mi</div></div><div class="event-actions"><a href="${directionsUrl(event)}" target="_blank" rel="noopener">Directions</a>${tickets}<a href="${calendarUrl(event)}" target="_blank" rel="noopener">Calendar</a></div></article>`;
};

render();
