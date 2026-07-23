const CONWAY={lat:35.0887,lon:-92.4421,label:"Conway, Arkansas"};
const teams=[{id:"uca",name:"UCA Bears",short:"UCA"},{id:"conway",name:"Conway Wampus Cats",short:"C"},{id:"greenbrier",name:"Greenbrier Panthers",short:"G"},{id:"vilonia",name:"Vilonia Eagles",short:"V"},{id:"hendrix",name:"Hendrix Warriors",short:"H"},{id:"cbc",name:"Central Baptist Mustangs",short:"CBC"}];
const events=[
{id:1,teamId:"uca",team:"UCA Bears",opponent:"Little Rock Trojans",sport:"basketball",level:"college",venue:"Farris Center",lat:35.0807,lon:-92.4576,date:"2026-11-14T19:00:00",tickets:"#"},
{id:2,teamId:"conway",team:"Conway Wampus Cats",opponent:"Bryant Hornets",sport:"football",level:"high-school",venue:"John McConnell Stadium",lat:35.0872,lon:-92.4628,date:"2026-09-04T19:00:00",tickets:"#"},
{id:3,teamId:"greenbrier",team:"Greenbrier Panthers",opponent:"Vilonia Eagles",sport:"football",level:"high-school",venue:"Don Jones Stadium",lat:35.2334,lon:-92.3870,date:"2026-09-11T19:00:00",tickets:"#"},
{id:4,teamId:"hendrix",team:"Hendrix Warriors",opponent:"Rhodes Lynx",sport:"football",level:"college",venue:"Young-Wise Memorial Stadium",lat:35.1008,lon:-92.4412,date:"2026-09-19T13:00:00",tickets:"#"},
{id:5,teamId:"cbc",team:"Central Baptist Mustangs",opponent:"Williams Baptist Eagles",sport:"basketball",level:"college",venue:"A.R. Reddin Fieldhouse",lat:35.0730,lon:-92.4568,date:"2026-12-05T17:00:00",tickets:"#"},
{id:6,teamId:"vilonia",team:"Vilonia Eagles",opponent:"Beebe Badgers",sport:"football",level:"high-school",venue:"Phillip D. Weaver Stadium",lat:35.0839,lon:-92.2029,date:"2026-09-25T19:00:00",tickets:"#"}
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
function calendarUrl(event){const start=new Date(event.date),end=new Date(start.getTime()+2*60*60*1000),fmt=d=>d.toISOString().replace(/[-:]/g,"").replace(/\.\d{3}Z$/,"Z"),text=encodeURIComponent(`${event.team} vs ${event.opponent}`),details=encodeURIComponent(`${event.sport} at ${event.venue}`),location=encodeURIComponent(event.venue);return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${text}&dates=${fmt(start)}/${fmt(end)}&details=${details}&location=${location}`;}
function badgeFor(teamId){return teams.find(t=>t.id===teamId)?.short||"★";}
function capitalize(value){return value.charAt(0).toUpperCase()+value.slice(1);}
function eventCard(event,priority=false){const dist=haversineMiles(center,event);return `<article class="event-card ${priority?"priority":""}"><div class="event-main"><div class="team-badge">${badgeFor(event.teamId)}</div><div><div class="event-title">${event.team}</div><div>${capitalize(event.sport)} vs. ${event.opponent}</div><div class="event-meta">${formatEventDate(event.date)} · ${event.venue}</div></div><div class="distance">${dist.toFixed(1)} mi</div></div><div class="event-actions"><a href="${directionsUrl(event)}" target="_blank" rel="noopener">Directions</a><a href="${event.tickets}" onclick="return false">Tickets</a><a href="${calendarUrl(event)}" target="_blank" rel="noopener">Calendar</a></div></article>`;}
function matchesFilter(event){return currentFilter==="all"||event.level===currentFilter||event.sport===currentFilter;}
function render(){const radius=Number(radiusEl.value),visible=events.map(e=>({...e,distance:haversineMiles(center,e)})).filter(e=>e.distance<=radius&&matchesFilter(e)).sort((a,b)=>a.distance-b.distance),priority=visible.filter(e=>followed.includes(e.teamId)),others=visible.filter(e=>!followed.includes(e.teamId));followedEventsEl.innerHTML=priority.length?priority.map(e=>eventCard(e,true)).join(""):`<div class="empty">No followed teams are playing inside ${radius} miles.</div>`;otherEventsEl.innerHTML=others.length?others.map(e=>eventCard(e)).join(""):`<div class="empty">No other games match these filters.</div>`;resultCountEl.textContent=`${visible.length} event${visible.length===1?"":"s"}`;}
function renderTeamChoices(){teamChoicesEl.innerHTML=teams.map(team=>`<label class="team-choice"><span><strong>${team.name}</strong></span><input type="checkbox" value="${team.id}" ${followed.includes(team.id)?"checked":""}></label>`).join("");}
document.querySelectorAll(".filter").forEach(btn=>btn.addEventListener("click",()=>{document.querySelectorAll(".filter").forEach(b=>b.classList.remove("active"));btn.classList.add("active");currentFilter=btn.dataset.filter;render();}));
radiusEl.addEventListener("change",render);
document.querySelector("#locateBtn").addEventListener("click",()=>{if(!navigator.geolocation){alert("Geolocation is not available on this device.");return;}navigator.geolocation.getCurrentPosition(pos=>{center={lat:pos.coords.latitude,lon:pos.coords.longitude};locationLabelEl.textContent="Current location";render();},()=>alert("Location permission was not granted. Using Conway instead."),{enableHighAccuracy:true,timeout:10000});});
function openTeams(){renderTeamChoices();dialog.showModal();}
document.querySelector("#editTeamsBtn").addEventListener("click",openTeams);
document.querySelector("#teamsNav").addEventListener("click",openTeams);
document.querySelector("#saveTeamsBtn").addEventListener("click",()=>{followed=[...teamChoicesEl.querySelectorAll("input:checked")].map(i=>i.value);localStorage.setItem("followedTeams",JSON.stringify(followed));render();});
if("serviceWorker" in navigator){window.addEventListener("load",()=>navigator.serviceWorker.register("service-worker.js"));}
render();
