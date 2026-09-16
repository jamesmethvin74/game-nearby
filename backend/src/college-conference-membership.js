import { ARKANSAS_COLLEGE_TEAM_INVENTORY } from "./college-team-inventory.js";

const CURRENT_OVERRIDES=new Map([
  ["uca|football|men",{name:"United Athletic Conference",source_url:"https://ucasports.com/news/2026/4/8/football-bears-release-updated-2026-schedule.aspx"}],
  ["uca|basketball|men",{name:"United Athletic Conference",source_url:"https://ucasports.com/story.aspx?file_date=6-26-2025&filename=general-asun-uac-announcement.aspx"}],
  ["uca|basketball|women",{name:"United Athletic Conference",source_url:"https://ucasports.com/story.aspx?file_date=6-26-2025&filename=general-asun-uac-announcement.aspx"}],
  ["uca|soccer|men",{name:"Atlantic Sun Conference",source_url:"https://ucasports.com/news/2026/7/23/mens-soccer-reveals-2026-schedule.aspx"}],
  ["uca|soccer|women",{name:"United Athletic Conference",source_url:"https://ucasports.com/news/2026/5/22/womens-soccer-unveils-2026-schedule.aspx"}],
  ["uca|volleyball|women",{name:"United Athletic Conference",source_url:"https://ucasports.com/news/2026/7/16/volleyball-sugar-bears-unveil-2026-schedule.aspx"}],
  ["little-rock|basketball|men",{name:"United Athletic Conference",source_url:"https://asunsports.org/news/2026/5/18/general-creating-whats-next-asun-and-uac-partner-to-launch-unisun-sports.aspx"}],
  ["little-rock|basketball|women",{name:"United Athletic Conference",source_url:"https://asunsports.org/news/2026/5/18/general-creating-whats-next-asun-and-uac-partner-to-launch-unisun-sports.aspx"}],
  ["little-rock|soccer|women",{name:"United Athletic Conference",source_url:"https://asunsports.org/news/2026/5/18/general-creating-whats-next-asun-and-uac-partner-to-launch-unisun-sports.aspx"}],
  ["little-rock|volleyball|women",{name:"United Athletic Conference",source_url:"https://asunsports.org/news/2026/5/18/general-creating-whats-next-asun-and-uac-partner-to-launch-unisun-sports.aspx"}],
  ["lyon|football|men",{name:"Southern Collegiate Athletic Conference",source_url:"https://lyonscots.com/news/2026/8/17/football-scots-football-sits-tied-4th-in-scac-preseason-poll.aspx"}],
  ["lyon|basketball|men",{name:"St. Louis Intercollegiate Athletic Conference",source_url:"https://lyonscots.com/news/2026/3/10/general-11-lyon-college-athletes-named-to-winter-sliac-all-academic-list.aspx"}],
  ["lyon|basketball|women",{name:"St. Louis Intercollegiate Athletic Conference",source_url:"https://lyonscots.com/news/2026/3/10/general-11-lyon-college-athletes-named-to-winter-sliac-all-academic-list.aspx"}],
  ["lyon|soccer|men",{name:"St. Louis Intercollegiate Athletic Conference",source_url:"https://lyonscots.com/sports/mens-soccer/schedule/2026"}],
  ["lyon|soccer|women",{name:"St. Louis Intercollegiate Athletic Conference",source_url:"https://lyonscots.com/news/2026/8/20/womens-soccer-lyon-womens-soccer-ranked-6th-in-sliac-preseason-poll.aspx"}],
  ["lyon|volleyball|women",{name:"St. Louis Intercollegiate Athletic Conference",source_url:"https://lyonscots.com/news/2026/8/18/womens-volleyball-scots-volleyball-ranked-tied-3rd-in-sliac-preaseaon-poll.aspx"}],
  ["arkansas-baptist|football|men",{name:"Continental Athletic Conference",source_url:"https://abcbuffaloes.com/news/2026/3/2/general-arkansas-baptist-mbb-captures-2026-cac-mens-basketball-championship.aspx"}],
  ["arkansas-baptist|basketball|men",{name:"Continental Athletic Conference",source_url:"https://abcbuffaloes.com/news/2026/3/2/general-arkansas-baptist-mbb-captures-2026-cac-mens-basketball-championship.aspx"}],
  ["arkansas-baptist|basketball|women",{name:"Continental Athletic Conference",source_url:"https://abcbuffaloes.com/"}],
  ["champion-christian|basketball|men",{name:"Continental Athletic Conference",source_url:"https://www.champion.edu/news/champion-christian-college-accepted-into-the-naia"}],
  ["champion-christian|basketball|women",{name:"Continental Athletic Conference",source_url:"https://www.champion.edu/news/champion-christian-college-accepted-into-the-naia"}],
  ["champion-christian|soccer|men",{name:"Continental Athletic Conference",source_url:"https://www.champion.edu/news/champion-christian-college-accepted-into-the-naia"}],
  ["champion-christian|soccer|women",{name:"Continental Athletic Conference",source_url:"https://www.champion.edu/news/champion-christian-college-accepted-into-the-naia"}],
  ["champion-christian|volleyball|women",{name:"Continental Athletic Conference",source_url:"https://www.champion.edu/"}]
]);

const AFFILIATION_NAMES=new Map([
  ["SEC","Southeastern Conference"],
  ["Sun Belt","Sun Belt Conference"],
  ["SWAC","Southwestern Athletic Conference"],
  ["United Athletic Conference","United Athletic Conference"],
  ["Great American Conference","Great American Conference"],
  ["MIAA","Mid-America Intercollegiate Athletics Association"],
  ["SCAC","Southern Collegiate Athletic Conference"],
  ["American Midwest Conference","American Midwest Conference"],
  ["Sooner Athletic Conference","Sooner Athletic Conference"],
  ["HBCU Athletic Conference","HBCU Athletic Conference"],
  ["Region 2","NJCAA Region 2"],
  ["Central Region","NCCAA Central Region"]
]);

function safe(value){return String(value||"").toLowerCase().replace(/&/g," and ").replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");}
function teamKey(schoolId,team){return `${schoolId}|${team.sport}|${team.gender}`;}
function conferenceId(name,team){return `${safe(name)}-${safe(team.sport)}-${safe(team.gender)}`;}

function defaultConference(school,team){
  const override=CURRENT_OVERRIDES.get(teamKey(school.schoolId,team));
  if(override) return {...override,authority_provider:"current-official-college-membership"};
  const name=AFFILIATION_NAMES.get(school.affiliation);
  if(name) return {name,source_url:school.sourceUrl,authority_provider:"verified-college-inventory"};
  if(school.schoolId==="cbc") return {name:"American Midwest Conference",source_url:"https://amcsportsonline.com/",authority_provider:"conference-roster-corroborated"};
  if(school.schoolId==="crowleys-ridge" || school.schoolId==="williams-baptist") return {name:"American Midwest Conference",source_url:school.sourceUrl,authority_provider:"verified-college-inventory"};
  return null;
}

export function buildCollegeConferenceMembership({season="2026",verifiedAt="2026-09-15T00:00:00.000Z"}={}) {
  const memberships=[];
  const conferences=new Map();
  const unresolved=[];
  for(const school of ARKANSAS_COLLEGE_TEAM_INVENTORY) {
    for(const team of school.teams) {
      const teamId=`${school.schoolId}-${team.sport}-${team.gender}-${season}`;
      const conference=defaultConference(school,team);
      if(!conference) {
        memberships.push({team_id:teamId,membership_state:"unknown",conference_id:null,classification:school.association,division:null,authority_provider:"college-membership-unresolved",authority_key:`${season}:${school.schoolId}:${team.sport}:${team.gender}`,source_url:school.sourceUrl,verified_at:verifiedAt});
        unresolved.push({team_id:teamId,school_id:school.schoolId,affiliation:school.affiliation});
        continue;
      }
      const id=conferenceId(conference.name,team);
      conferences.set(id,{id,name:conference.name,classification:school.association,source_url:conference.source_url,standings_method:"calculated",coverage_complete:0});
      memberships.push({team_id:teamId,membership_state:"member",conference_id:id,classification:school.association,division:conference.name,authority_provider:conference.authority_provider,authority_key:`${season}:${school.schoolId}:${team.sport}:${team.gender}`,source_url:conference.source_url,verified_at:verifiedAt});
    }
  }
  return {memberships,conferences:[...conferences.values()],unresolved};
}

export { CURRENT_OVERRIDES };
