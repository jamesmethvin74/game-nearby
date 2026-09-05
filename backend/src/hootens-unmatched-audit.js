import { normalizeHootensRows, expandedAlias } from "./hootens-statewide-results.js";

const ARCHIVE_URL="https://hootens.com/weekly-matchups/";
const USER_AGENT="LocalBleachersAR/2.0 (+https://github.com/jamesmethvin74/game-nearby)";
const LOOKBACK_HOURS=42;
const LOOKAHEAD_HOURS=8;

function clean(value){return String(value??"").replace(/\u00a0/g," ").replace(/\s+/g," ").trim();}

function appendControlValue(row,cellIndex,value){
  const text=clean(value);
  if(!row||cellIndex<0||!text)return;
  if(!Array.isArray(row.controls[cellIndex]))row.controls[cellIndex]=[];
  row.controls[cellIndex].push(text);
}

async function extractScoreboardRows(html,HTMLRewriterClass=globalThis.HTMLRewriter){
  if(!HTMLRewriterClass) throw new Error("HTMLRewriter unavailable for Hooten scoreboard audit");
  const state={current:null,rows:[]};
  const response=new HTMLRewriterClass()
    .on("tr",{element(el){state.current={cells:["","","","",""],controls:[[],[],[],[],[],[]],cellIndex:-1,teamLinks:[],activeLink:null,activeSelectedOption:null};state.rows.push(state.current);el.onEndTag(()=>{state.current=null;});}})
    .on("tr td",{
      element(el){if(!state.current)return;state.current.cellIndex+=1;const index=state.current.cellIndex;appendControlValue(state.current,index,el.getAttribute("data-value"));appendControlValue(state.current,index,el.getAttribute("data-score"));appendControlValue(state.current,index,el.getAttribute("data-status"));},
      text(chunk){if(state.current&&state.current.cellIndex>=0&&state.current.cellIndex<state.current.cells.length)state.current.cells[state.current.cellIndex]+=chunk.text+" ";}
    })
    .on("tr td input",{element(el){if(state.current)appendControlValue(state.current,state.current.cellIndex,el.getAttribute("value"));}})
    .on("tr td select",{element(el){if(state.current)appendControlValue(state.current,state.current.cellIndex,el.getAttribute("value"));}})
    .on("tr td option[selected]",{
      element(el){if(!state.current)return;const selected={cellIndex:state.current.cellIndex,text:""};state.current.activeSelectedOption=selected;appendControlValue(state.current,selected.cellIndex,el.getAttribute("value"));el.onEndTag(()=>{if(!state.current||state.current.activeSelectedOption!==selected)return;appendControlValue(state.current,selected.cellIndex,selected.text);state.current.activeSelectedOption=null;});},
      text(chunk){if(state.current?.activeSelectedOption)state.current.activeSelectedOption.text+=chunk.text+" ";}
    })
    .on("tr a[href*='/teams/']",{element(el){if(!state.current)return;const link={href:el.getAttribute("href")||"",text:""};state.current.teamLinks.push(link);state.current.activeLink=link;el.onEndTag(()=>{if(state.current)state.current.activeLink=null;});},text(chunk){if(state.current?.activeLink)state.current.activeLink.text+=chunk.text+" ";}})
    .transform(new Response(html));
  await response.text();
  return state.rows;
}

async function currentFinals(fetchFn=fetch,HTMLRewriterClass=globalThis.HTMLRewriter){
  const archive=await fetchFn(ARCHIVE_URL,{headers:{"user-agent":USER_AGENT,"accept":"text/html,application/xhtml+xml"},redirect:"follow"});
  if(!archive.ok)throw new Error(`Hooten archive HTTP ${archive.status}`);
  const anchors=[];let active=null;
  const parsed=new HTMLRewriterClass().on("a",{element(el){active={href:el.getAttribute("href")||"",text:""};anchors.push(active);el.onEndTag(()=>{active=null;});},text(chunk){if(active)active.text+=chunk.text+" ";}}).transform(new Response(await archive.text()));
  await parsed.text();
  const found=anchors.find(item=>/scoreboard\s+week\s+\d+/i.test(clean(item.text))&&/\/matchup\//i.test(item.href));
  if(!found)throw new Error("Hooten current scoreboard link not found");
  const scoreboardUrl=new URL(found.href,ARCHIVE_URL).toString();
  const scoreboard=await fetchFn(scoreboardUrl,{headers:{"user-agent":USER_AGENT,"accept":"text/html,application/xhtml+xml"},redirect:"follow"});
  if(!scoreboard.ok)throw new Error(`Hooten scoreboard HTTP ${scoreboard.status}`);
  return {scoreboardUrl,finals:normalizeHootensRows(await extractScoreboardRows(await scoreboard.text(),HTMLRewriterClass))};
}

function indexSchoolAliases(schools,aliases){
  const byAlias=new Map();
  const add=(alias,school)=>{const key=expandedAlias(alias);if(!key)return;const current=byAlias.get(key);if(!current)byAlias.set(key,school);else if(current.school_id!==school.school_id)byAlias.set(key,null);};
  for(const school of schools){add(school.school_name,school);add(`${school.school_name} ${school.mascot||""}`,school);}
  const schoolById=new Map(schools.map(s=>[s.school_id,s]));
  for(const alias of aliases){const school=schoolById.get(alias.school_id);if(school)add(alias.alias_text||alias.normalized_alias,school);}
  return byAlias;
}

function chooseAnchor(candidates,opponentName,opponentSchoolId){
  if(!candidates?.length)return null;
  if(opponentSchoolId){const exact=candidates.find(g=>g.opponent_school_id===opponentSchoolId);if(exact)return exact;}
  const target=expandedAlias(opponentName);
  return candidates.find(g=>expandedAlias(g.opponent)===target)||candidates[0]||null;
}

export async function auditHootensUnmatched(env,{fetchFn=fetch,HTMLRewriterClass=globalThis.HTMLRewriter}={}){
  const fetched=await currentFinals(fetchFn,HTMLRewriterClass);
  if(!fetched.finals.length)throw new Error("Hooten audit parsed zero finals");
  const [schoolsResult,aliasesResult,gamesResult]=await Promise.all([
    env.DB.prepare(`SELECT t.id AS team_id,t.school_id,s.name AS school_name,s.mascot FROM teams t JOIN schools s ON s.id=t.school_id WHERE t.active=1 AND t.sport='football' AND t.gender='boys' AND t.season='2026' AND s.level='high-school' AND s.state='AR' AND s.catalog_scope='local'`).all(),
    env.DB.prepare(`SELECT sa.normalized_alias,sa.alias_text,sa.school_id FROM school_aliases sa JOIN teams t ON t.school_id=sa.school_id WHERE t.active=1 AND t.sport='football' AND t.gender='boys' AND t.season='2026'`).all(),
    env.DB.prepare(`SELECT g.id,g.team_id,g.opponent,g.opponent_school_id,g.scheduled_at,g.canonical_event_id,t.school_id,s.name AS school_name FROM games g JOIN sources src ON src.id=g.source_id JOIN teams t ON t.id=g.team_id JOIN schools s ON s.id=t.school_id WHERE t.active=1 AND t.sport='football' AND t.gender='boys' AND t.season='2026' AND s.level='high-school' AND s.state='AR' AND s.catalog_scope='local' AND datetime(g.scheduled_at) BETWEEN datetime('now','-${LOOKBACK_HOURS} hours') AND datetime('now','+${LOOKAHEAD_HOURS} hours') ORDER BY src.authority_rank,src.source_priority,src.id`).all()
  ]);
  const schools=schoolsResult.results||[],aliases=aliasesResult.results||[],games=gamesResult.results||[];
  const aliasIndex=indexSchoolAliases(schools,aliases);
  const gamesBySchool=new Map();
  for(const game of games){if(!gamesBySchool.has(game.school_id))gamesBySchool.set(game.school_id,[]);gamesBySchool.get(game.school_id).push(game);}
  const unmatched=[];let matched=0;
  for(const final of fetched.finals){
    const left=aliasIndex.get(expandedAlias(final.homeName))||null;
    const right=aliasIndex.get(expandedAlias(final.awayName))||null;
    const reporting=left||right;
    if(!reporting){
      unmatched.push({home:final.homeName,away:final.awayName,homeScore:final.homeScore,awayScore:final.awayScore,reason:"no_local_school_match",homeAlias:expandedAlias(final.homeName),awayAlias:expandedAlias(final.awayName)});
      continue;
    }
    const reportingIsLeft=Boolean(left);
    const opponentLocal=reportingIsLeft?right:left;
    const opponentName=reportingIsLeft?final.awayName:final.homeName;
    const candidates=gamesBySchool.get(reporting.school_id)||[];
    const anchor=chooseAnchor(candidates,opponentName,opponentLocal?.school_id||null);
    if(!anchor){
      unmatched.push({home:final.homeName,away:final.awayName,homeScore:final.homeScore,awayScore:final.awayScore,reason:"no_recent_game_anchor",schoolId:reporting.school_id,schoolName:reporting.school_name,opponentAlias:expandedAlias(opponentName),candidateCount:candidates.length});
      continue;
    }
    matched++;
  }
  return {
    status:"SUCCESS",
    scoreboardUrl:fetched.scoreboardUrl,
    finals:fetched.finals.length,
    matched,
    unmatched:unmatched.length,
    rowsRead:Number(schoolsResult.meta?.rows_read||0)+Number(aliasesResult.meta?.rows_read||0)+Number(gamesResult.meta?.rows_read||0),
    unmatchedGames:unmatched
  };
}
