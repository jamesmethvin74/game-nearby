const CONWAY={lat:35.0887,lon:-92.4421,label:"Conway, Arkansas"};
const CONWAY_TICKETS_URL="https://gofan.co/school/AR4663";

const teams=[
  {id:"uca",name:"UCA Bears",short:"UCA"},
  {id:"conway",name:"Conway Wampus Cats",short:"C"},
  {id:"greenbrier",name:"Greenbrier Panthers",short:"G"},
  {id:"vilonia",name:"Vilonia Eagles",short:"V"},
  {id:"hendrix",name:"Hendrix Warriors",short:"H"},
  {id:"cbc",name:"Central Baptist Mustangs",short:"CBC"}
];

const LOC={
  conway:{lat:35.0887,lon:-92.4421,venue:"Conway High School"},
  footballHome:{lat:35.0872,lon:-92.4628,venue:"John McConnell Stadium"},
  basketballHome:{lat:35.0887,lon:-92.4421,venue:"Buzz Bolding Arena"},
  volleyballHome:{lat:35.0887,lon:-92.4421,venue:"Buzz Bolding Arena"},
  morrilton:{lat:35.1509,lon:-92.7430,venue:"Morrilton"},
  marion:{lat:35.2145,lon:-90.1965,venue:"Marion High School"},
  fortSmith:{lat:35.3859,lon:-94.3985,venue:"Fort Smith Northside"},
  northLittleRock:{lat:34.7695,lon:-92.2671,venue:"North Little Rock High School"},
  cabot:{lat:34.9745,lon:-92.0165,venue:"Cabot High School"},
  littleRock:{lat:34.7465,lon:-92.2896,venue:"Little Rock"},
  bryant:{lat:34.5959,lon:-92.4890,venue:"Bryant High School"},
  bentonville:{lat:36.3729,lon:-94.2088,venue:"Bentonville High School"},
  fayetteville:{lat:36.0626,lon:-94.1574,venue:"Fayetteville High School"},
  springdale:{lat:36.1867,lon:-94.1288,venue:"Springdale High School"},
  russellville:{lat:35.2784,lon:-93.1338,venue:"Russellville High School"},
  harBer:{lat:36.1937,lon:-94.2191,venue:"Har-Ber High School"},
  maumelle:{lat:34.8529,lon:-92.4043,venue:"Maumelle High School"},
  jonesboro:{lat:35.8423,lon:-90.7043,venue:"Jonesboro High School"},
  lakeHamilton:{lat:34.4515,lon:-93.1283,venue:"Lake Hamilton High School"},
  greenwood:{lat:35.2156,lon:-94.2558,venue:"Greenwood High School"},
  vanBuren:{lat:35.4368,lon:-94.3483,venue:"Van Buren High School"},
  greenbrier:{lat:35.2334,lon:-92.3870,venue:"Greenbrier High School"},
  benton:{lat:34.5645,lon:-92.5868,venue:"Benton High School"}
};

const OFFICIAL_FOOTBALL="https://www.conwaywampuscats.com/sport/football/boys/?tab=schedule";
const MAXPREPS_BOYS_BASKETBALL="https://www.maxpreps.com/ar/conway/conway-wampus-cats/basketball/schedule/";
const MAXPREPS_GIRLS_BASKETBALL="https://www.maxpreps.com/ar/conway/conway-wampus-cats/basketball/girls/";
const MAXPREPS_VOLLEYBALL="https://www.maxpreps.com/ar/conway/conway-wampus-cats/volleyball/schedule/";

function ev(id,{sport,gender,opponent,date,home=true,loc,venue,source="official",sourceUrl,notes=""}){
  const p=loc||LOC.conway;
  return {id,teamId:"conway",team:"Conway Wampus Cats",sport,gender,level:"high-school",opponent,date,home,lat:p.lat,lon:p.lon,venue:venue||p.venue,source,sourceUrl,notes};
}

const events=[
  ev("fb-0818",{sport:"football",gender:"boys",opponent:"Morrilton",date:"2026-08-18T18:00:00-05:00",home:true,loc:LOC.footballHome,venue:"John McConnell Stadium",sourceUrl:OFFICIAL_FOOTBALL,notes:"Benefit Game"}),
  ev("fb-0828",{sport:"football",gender:"boys",opponent:"Capital High School (MO)",date:"2026-08-28T19:00:00-05:00",home:true,loc:LOC.footballHome,venue:"John McConnell Stadium",sourceUrl:OFFICIAL_FOOTBALL}),
  ev("fb-0904",{sport:"football",gender:"boys",opponent:"Bentonville",date:"2026-09-04T19:00:00-05:00",home:true,loc:LOC.footballHome,venue:"John McConnell Stadium",sourceUrl:OFFICIAL_FOOTBALL}),
  ev("fb-0911",{sport:"football",gender:"boys",opponent:"Marion",date:"2026-09-11T19:00:00-05:00",home:false,loc:LOC.marion,sourceUrl:OFFICIAL_FOOTBALL}),
  ev("fb-0925",{sport:"football",gender:"boys",opponent:"Northside",date:"2026-09-25T19:00:00-05:00",home:false,loc:LOC.fortSmith,sourceUrl:OFFICIAL_FOOTBALL}),
  ev("fb-1002",{sport:"football",gender:"boys",opponent:"North Little Rock",date:"2026-10-02T19:00:00-05:00",home:true,loc:LOC.footballHome,venue:"John McConnell Stadium",sourceUrl:OFFICIAL_FOOTBALL}),
  ev("fb-1009",{sport:"football",gender:"boys",opponent:"Cabot",date:"2026-10-09T19:00:00-05:00",home:false,loc:LOC.cabot,sourceUrl:OFFICIAL_FOOTBALL}),
  ev("fb-1016",{sport:"football",gender:"boys",opponent:"Little Rock Central",date:"2026-10-16T19:00:00-05:00",home:true,loc:LOC.footballHome,venue:"John McConnell Stadium",sourceUrl:OFFICIAL_FOOTBALL}),
  ev("fb-1023",{sport:"football",gender:"boys",opponent:"Pulaski Academy",date:"2026-10-23T19:00:00-05:00",home:false,loc:LOC.littleRock,venue:"Pulaski Academy",sourceUrl:OFFICIAL_FOOTBALL}),
  ev("fb-1030",{sport:"football",gender:"boys",opponent:"Little Rock Christian",date:"2026-10-30T19:00:00-05:00",home:true,loc:LOC.footballHome,venue:"John McConnell Stadium",sourceUrl:OFFICIAL_FOOTBALL}),
  ev("fb-1106",{sport:"football",gender:"boys",opponent:"Bryant",date:"2026-11-06T19:00:00-06:00",home:false,loc:LOC.bryant,sourceUrl:OFFICIAL_FOOTBALL}),
  ev("bb-b-1112",{sport:"basketball",gender:"boys",opponent:"Fayetteville",date:"2026-11-12T18:00:00-06:00",home:false,loc:LOC.fayetteville,source:"secondary",sourceUrl:MAXPREPS_BOYS_BASKETBALL}),
  ev("bb-b-1117",{sport:"basketball",gender:"boys",opponent:"Springdale",date:"2026-11-17T19:00:00-06:00",home:false,loc:LOC.springdale,source:"secondary",sourceUrl:MAXPREPS_BOYS_BASKETBALL}),
  ev("bb-b-1119",{sport:"basketball",gender:"boys",opponent:"Russellville",date:"2026-11-19T19:00:00-06:00",home:false,loc:LOC.russellville,source:"secondary",sourceUrl:MAXPREPS_BOYS_BASKETBALL}),
  ev("bb-b-1121",{sport:"basketball",gender:"boys",opponent:"Fort Smith Patriots",date:"2026-11-21T19:00:00-06:00",home:true,loc:LOC.basketballHome,source:"secondary",sourceUrl:MAXPREPS_BOYS_BASKETBALL}),
  ev("bb-b-1124",{sport:"basketball",gender:"boys",opponent:"Har-Ber",date:"2026-11-24T18:30:00-06:00",home:false,loc:LOC.harBer,source:"secondary",sourceUrl:MAXPREPS_BOYS_BASKETBALL}),
  ev("bb-b-1201",{sport:"basketball",gender:"boys",opponent:"Fort Smith Patriots",date:"2026-12-01T19:30:00-06:00",home:true,loc:LOC.basketballHome,source:"secondary",sourceUrl:MAXPREPS_BOYS_BASKETBALL}),
  ev("bb-b-1203",{sport:"basketball",gender:"boys",opponent:"Sylvan Hills",date:"2026-12-03T19:30:00-06:00",home:true,loc:LOC.basketballHome,source:"secondary",sourceUrl:MAXPREPS_BOYS_BASKETBALL}),
  ev("bb-b-1208",{sport:"basketball",gender:"boys",opponent:"Bentonville",date:"2026-12-08T18:00:00-06:00",home:true,loc:LOC.basketballHome,source:"secondary",sourceUrl:MAXPREPS_BOYS_BASKETBALL}),
  ev("bb-b-1215",{sport:"basketball",gender:"boys",opponent:"Maumelle",date:"2026-12-15T18:00:00-06:00",home:false,loc:LOC.maumelle,source:"secondary",sourceUrl:MAXPREPS_BOYS_BASKETBALL}),
  ev("bb-b-0105",{sport:"basketball",gender:"boys",opponent:"Little Rock Southwest",date:"2027-01-05T19:30:00-06:00",home:true,loc:LOC.basketballHome,source:"secondary",sourceUrl:MAXPREPS_BOYS_BASKETBALL}),
  ev("bb-b-0108",{sport:"basketball",gender:"boys",opponent:"North Little Rock",date:"2027-01-08T19:30:00-06:00",home:true,loc:LOC.basketballHome,source:"secondary",sourceUrl:MAXPREPS_BOYS_BASKETBALL}),
  ev("bb-b-0112",{sport:"basketball",gender:"boys",opponent:"Cabot",date:"2027-01-12T19:30:00-06:00",home:false,loc:LOC.cabot,source:"secondary",sourceUrl:MAXPREPS_BOYS_BASKETBALL}),
  ev("bb-b-0119",{sport:"basketball",gender:"boys",opponent:"Little Rock Central",date:"2027-01-19T19:30:00-06:00",home:false,loc:LOC.littleRock,venue:"Little Rock Central High",source:"secondary",sourceUrl:MAXPREPS_BOYS_BASKETBALL}),
  ev("bb-b-0126",{sport:"basketball",gender:"boys",opponent:"Jonesboro",date:"2027-01-26T18:00:00-06:00",home:true,loc:LOC.basketballHome,source:"secondary",sourceUrl:MAXPREPS_BOYS_BASKETBALL}),
  ev("bb-b-0129",{sport:"basketball",gender:"boys",opponent:"Bryant",date:"2027-01-29T19:00:00-06:00",home:false,loc:LOC.bryant,source:"secondary",sourceUrl:MAXPREPS_BOYS_BASKETBALL}),
  ev("bb-b-0202",{sport:"basketball",gender:"boys",opponent:"Little Rock Southwest",date:"2027-02-02T19:30:00-06:00",home:false,loc:LOC.littleRock,venue:"Little Rock Southwest High",source:"secondary",sourceUrl:MAXPREPS_BOYS_BASKETBALL}),
  ev("bb-b-0205",{sport:"basketball",gender:"boys",opponent:"North Little Rock",date:"2027-02-05T19:30:00-06:00",home:false,loc:LOC.northLittleRock,source:"secondary",sourceUrl:MAXPREPS_BOYS_BASKETBALL}),
  ev("bb-b-0209",{sport:"basketball",gender:"boys",opponent:"Cabot",date:"2027-02-09T19:30:00-06:00",home:true,loc:LOC.basketballHome,source:"secondary",sourceUrl:MAXPREPS_BOYS_BASKETBALL}),
  ev("bb-b-0212",{sport:"basketball",gender:"boys",opponent:"Lake Hamilton",date:"2027-02-12T19:30:00-06:00",home:true,loc:LOC.basketballHome,source:"secondary",sourceUrl:MAXPREPS_BOYS_BASKETBALL}),
  ev("bb-b-0219",{sport:"basketball",gender:"boys",opponent:"Little Rock Central",date:"2027-02-19T19:30:00-06:00",home:true,loc:LOC.basketballHome,source:"secondary",sourceUrl:MAXPREPS_BOYS_BASKETBALL}),
  ev("bb-b-0223",{sport:"basketball",gender:"boys",opponent:"Jonesboro",date:"2027-02-23T18:00:00-06:00",home:false,loc:LOC.jonesboro,source:"secondary",sourceUrl:MAXPREPS_BOYS_BASKETBALL}),
  ev("bb-b-0226",{sport:"basketball",gender:"boys",opponent:"Bryant",date:"2027-02-26T19:00:00-06:00",home:true,loc:LOC.basketballHome,source:"secondary",sourceUrl:MAXPREPS_BOYS_BASKETBALL}),
  ev("bb-g-1117",{sport:"basketball",gender:"girls",opponent:"Springdale",date:"2026-11-17T18:00:00-06:00",home:false,loc:LOC.springdale,source:"secondary",sourceUrl:MAXPREPS_GIRLS_BASKETBALL}),
  ev("bb-g-1120",{sport:"basketball",gender:"girls",opponent:"Robinson",date:"2026-11-20T18:00:00-06:00",home:true,loc:LOC.basketballHome,source:"secondary",sourceUrl:MAXPREPS_GIRLS_BASKETBALL}),
  ev("bb-g-1121",{sport:"basketball",gender:"girls",opponent:"Pulaski Academy",date:"2026-11-21T15:00:00-06:00",home:true,loc:LOC.basketballHome,source:"secondary",sourceUrl:MAXPREPS_GIRLS_BASKETBALL}),
  ev("vb-0824",{sport:"volleyball",gender:"girls",opponent:"Benton",date:"2026-08-24T18:00:00-05:00",home:true,loc:LOC.volleyballHome,source:"secondary",sourceUrl:MAXPREPS_VOLLEYBALL}),
  ev("vb-0827",{sport:"volleyball",gender:"girls",opponent:"Greenwood",date:"2026-08-27T18:00:00-05:00",home:false,loc:LOC.greenwood,source:"secondary",sourceUrl:MAXPREPS_VOLLEYBALL}),
  ev("vb-0831",{sport:"volleyball",gender:"girls",opponent:"Lakeside",date:"2026-08-31T18:00:00-05:00",home:true,loc:LOC.volleyballHome,source:"secondary",sourceUrl:MAXPREPS_VOLLEYBALL}),
  ev("vb-0903",{sport:"volleyball",gender:"girls",opponent:"Little Rock Southwest",date:"2026-09-03T18:00:00-05:00",home:false,loc:LOC.littleRock,venue:"Little Rock Southwest High",source:"secondary",sourceUrl:MAXPREPS_VOLLEYBALL}),
  ev("vb-0908",{sport:"volleyball",gender:"girls",opponent:"North Little Rock",date:"2026-09-08T18:00:00-05:00",home:true,loc:LOC.volleyballHome,source:"secondary",sourceUrl:MAXPREPS_VOLLEYBALL}),
  ev("vb-0910",{sport:"volleyball",gender:"girls",opponent:"Cabot",date:"2026-09-10T18:00:00-05:00",home:false,loc:LOC.cabot,source:"secondary",sourceUrl:MAXPREPS_VOLLEYBALL}),
  ev("vb-0915",{sport:"volleyball",gender:"girls",opponent:"Van Buren",date:"2026-09-15T18:00:00-05:00",home:true,loc:LOC.volleyballHome,source:"secondary",sourceUrl:MAXPREPS_VOLLEYBALL}),
  ev("vb-0917",{sport:"volleyball",gender:"girls",opponent:"Little Rock Central",date:"2026-09-17T18:00:00-05:00",home:false,loc:LOC.littleRock,venue:"Little Rock Central High",source:"secondary",sourceUrl:MAXPREPS_VOLLEYBALL}),
  ev("vb-0922",{sport:"volleyball",gender:"girls",opponent:"Jonesboro",date:"2026-09-22T18:00:00-05:00",home:true,loc:LOC.volleyballHome,source:"secondary",sourceUrl:MAXPREPS_VOLLEYBALL}),
  ev("vb-0924",{sport:"volleyball",gender:"girls",opponent:"Bryant",date:"2026-09-24T18:00:00-05:00",home:false,loc:LOC.bryant,source:"secondary",sourceUrl:MAXPREPS_VOLLEYBALL}),
  ev("vb-0928",{sport:"volleyball",gender:"girls",opponent:"Greenbrier",date:"2026-09-28T17:30:00-05:00",home:false,loc:LOC.greenbrier,source:"secondary",sourceUrl:MAXPREPS_VOLLEYBALL}),
  ev("vb-0929",{sport:"volleyball",gender:"girls",opponent:"Little Rock Southwest",date:"2026-09-29T18:00:00-05:00",home:true,loc:LOC.volleyballHome,source:"secondary",sourceUrl:MAXPREPS_VOLLEYBALL}),
  ev("vb-1001",{sport:"volleyball",gender:"girls",opponent:"North Little Rock",date:"2026-10-01T18:00:00-05:00",home:false,loc:LOC.northLittleRock,source:"secondary",sourceUrl:MAXPREPS_VOLLEYBALL}),
  ev("vb-1006",{sport:"volleyball",gender:"girls",opponent:"Cabot",date:"2026-10-06T18:00:00-05:00",home:true,loc:LOC.volleyballHome,source:"secondary",sourceUrl:MAXPREPS_VOLLEYBALL}),
  ev("vb-1010",{sport:"volleyball",gender:"girls",opponent:"Bentonville West",date:"2026-10-10T08:00:00-05:00",home:true,loc:LOC.volleyballHome,source:"secondary",sourceUrl:MAXPREPS_VOLLEYBALL}),
  ev("vb-1013",{sport:"volleyball",gender:"girls",opponent:"Little Rock Central",date:"2026-10-13T18:00:00-05:00",home:true,loc:LOC.volleyballHome,source:"secondary",sourceUrl:MAXPREPS_VOLLEYBALL}),
  ev("vb-1015",{sport:"volleyball",gender:"girls",opponent:"Jonesboro",date:"2026-10-15T18:00:00-05:00",home:false,loc:LOC.jonesboro,source:"secondary",sourceUrl:MAXPREPS_VOLLEYBALL}),
  ev("vb-1020",{sport:"volleyball",gender:"girls",opponent:"Bryant",date:"2026-10-20T18:00:00-05:00",home:true,loc:LOC.volleyballHome,source:"secondary",sourceUrl:MAXPREPS_VOLLEYBALL}),
  ev("vb-1022",{sport:"volleyball",gender:"girls",opponent:"Benton",date:"2026-10-22T18:00:00-05:00",home:false,loc:LOC.benton,source:"secondary",sourceUrl:MAXPREPS_VOLLEYBALL})
];

let center={...CONWAY};
let currentFilter="all";
let followed=JSON.parse(localStorage.getItem("followedTeams")||'["uca","conway"]');
const radiusEl=document.querySelector("#radius");
const followedEventsEl=document.querySelector("#followedEvents");
const otherEventsEl=document.querySelector("#otherEvents");
const resultCountEl=document.querySelector("#resultCount");
const locationLabelEl=document.querySelector("#locationLabel");
const dialog=document.querySelector("#teamsDialog");
const teamChoicesEl=document.querySelector("#teamChoices");

function haversineMiles(a,b){const R=3958.8,toRad=d=>d*Math.PI/180,dLat=toRad(b.lat-a.lat),dLon=toRad(b.lon-a.lon),lat1=toRad(a.lat),lat2=toRad(b.lat),h=Math.sin(dLat/2)**2+Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLon/2)**2;return 2*R*Math.asin(Math.sqrt(h));}
function formatEventDate(iso){return new Date(iso).toLocaleString([],{weekday:"short",month:"short",day:"numeric",hour:"numeric",minute:"2-digit"});}
function directionsUrl(event){return `https://www.google.com/maps/search/?api=1&query=${event.lat},${event.lon}`;}
function calendarUrl(event){const start=new Date(event.date),end=new Date(start.getTime()+2*60*60*1000),fmt=d=>d.toISOString().replace(/[-:]/g,"").replace(/\.\d{3}Z$/,"Z"),text=encodeURIComponent(`${event.team} ${event.home?"vs":"at"} ${event.opponent}`),details=encodeURIComponent(`${event.gender} ${event.sport} at ${event.venue}`),location=encodeURIComponent(event.venue);return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${text}&dates=${fmt(start)}/${fmt(end)}&details=${details}&location=${location}`;}
function badgeFor(teamId){return teams.find(t=>t.id===teamId)?.short||"★";}
function capitalize(value){return value.charAt(0).toUpperCase()+value.slice(1);}
function sourceLabel(event){return event.source==="official"?"Official Conway Athletics":"Schedule source: MaxPreps";}
function eventCard(event,priority=false){
  const dist=haversineMiles(center,event);
  const matchup=`${event.home?"vs.":"at"} ${event.opponent}`;
  const locationClass=event.home?"home-game":"away-game";
  const locationLabel=event.home?"HOME":"AWAY";
  return `<article class="event-card ${priority?"priority ":""}${locationClass}"><div class="event-main"><div class="team-badge">${badgeFor(event.teamId)}</div><div><div class="event-title">${event.team}</div><span class="home-away-badge">${locationLabel}</span><div>${capitalize(event.gender)} ${capitalize(event.sport)} · ${matchup}</div><div class="event-meta">${formatEventDate(event.date)} · ${event.venue}${event.notes?` · ${event.notes}`:""}</div><div class="event-meta"><a href="${event.sourceUrl}" target="_blank" rel="noopener">${sourceLabel(event)}</a></div></div><div class="distance">${dist.toFixed(1)} mi</div></div><div class="event-actions"><a href="${directionsUrl(event)}" target="_blank" rel="noopener">Directions</a><a class="ticket-action" href="${CONWAY_TICKETS_URL}" target="_blank" rel="noopener">Tickets</a><a href="${calendarUrl(event)}" target="_blank" rel="noopener">Calendar</a></div></article>`;
}
function matchesFilter(event){return currentFilter==="all"||event.level===currentFilter||event.sport===currentFilter;}
function isUpcoming(event){return new Date(event.date).getTime()>=Date.now()-3*60*60*1000;}
function render(){const radius=Number(radiusEl.value),visible=events.filter(isUpcoming).map(e=>({...e,distance:haversineMiles(center,e)})).filter(e=>e.distance<=radius&&matchesFilter(e)).sort((a,b)=>new Date(a.date)-new Date(b.date)||a.distance-b.distance),priority=visible.filter(e=>followed.includes(e.teamId)),others=visible.filter(e=>!followed.includes(e.teamId));followedEventsEl.innerHTML=priority.length?priority.map(e=>eventCard(e,true)).join(""):`<div class="empty">No followed teams have upcoming games inside ${radius} miles.</div>`;otherEventsEl.innerHTML=others.length?others.map(e=>eventCard(e)).join(""):`<div class="empty">No other upcoming games match these filters.</div>`;resultCountEl.textContent=`${visible.length} event${visible.length===1?"":"s"}`;}
function renderTeamChoices(){teamChoicesEl.innerHTML=teams.map(team=>`<label class="team-choice"><span><strong>${team.name}</strong></span><input type="checkbox" value="${team.id}" ${followed.includes(team.id)?"checked":""}></label>`).join("");}
document.querySelectorAll(".filter").forEach(btn=>btn.addEventListener("click",()=>{document.querySelectorAll(".filter").forEach(b=>b.classList.remove("active"));btn.classList.add("active");currentFilter=btn.dataset.filter;render();}));
radiusEl.addEventListener("change",render);
document.querySelector("#locateBtn").addEventListener("click",()=>{if(!navigator.geolocation){alert("Geolocation is not available on this device.");return;}navigator.geolocation.getCurrentPosition(pos=>{center={lat:pos.coords.latitude,lon:pos.coords.longitude};locationLabelEl.textContent="Current location";render();},()=>alert("Location permission was not granted. Using Conway instead."),{enableHighAccuracy:true,timeout:10000});});
function openTeams(){renderTeamChoices();dialog.showModal();}
document.querySelector("#editTeamsBtn").addEventListener("click",openTeams);
document.querySelector("#teamsNav").addEventListener("click",openTeams);
document.querySelector("#saveTeamsBtn").addEventListener("click",()=>{followed=[...teamChoicesEl.querySelectorAll("input:checked")].map(i=>i.value);localStorage.setItem("followedTeams",JSON.stringify(followed));render();});
render();
