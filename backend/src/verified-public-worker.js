import app from "./m8-worker.js";
import { applyLogoRelays } from "./catalog-identity-worker.js";
import { recordFromScheduleRows } from "./schedule-response-normalizer.js";

export const COLLEGE_TRUST_PREVIEW_PATH = "/api/v1/preview/college-trust";
const RESULT_ORIENTATION_RELEASE = "explicit-result-v1";
const LOGO_DELIVERY_RELEASE = "same-origin-relay-v1";

function clean(value) {
  return String(value ?? "").trim();
}

function finiteScore(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function recordGameCount(record = {}) {
  return Number(record.wins || 0) + Number(record.losses || 0) + Number(record.ties || 0);
}

function recordText(record = {}) {
  const wins = Number(record.wins || 0);
  const losses = Number(record.losses || 0);
  const ties = Number(record.ties || 0);
  return ties > 0 ? `${wins}-${losses}-${ties}` : `${wins}-${losses}`;
}

export function orientFinalScoreToExplicitResult(row = {}) {
  const next = { ...row };
  if (clean(next.status).toUpperCase() !== "FINAL") return next;

  const result = clean(next.result).toUpperCase();
  if (result !== "W" && result !== "L" && result !== "T") return next;

  const teamScore = finiteScore(next.team_score);
  const opponentScore = finiteScore(next.opponent_score);
  if (teamScore === null || opponentScore === null) return next;

  const scoreResult = teamScore === opponentScore ? "T" : teamScore > opponentScore ? "W" : "L";
  if (scoreResult === result) return next;

  const reversible = (result === "W" && scoreResult === "L") || (result === "L" && scoreResult === "W");
  if (!reversible) return next;

  next.team_score = next.opponent_score;
  next.opponent_score = next.team_score === teamScore ? opponentScore : teamScore;
  // The two assignments above deliberately preserve the original value types.
  // Re-apply from the original row so the swap cannot depend on coercion.
  next.team_score = row.opponent_score;
  next.opponent_score = row.team_score;
  next.score_orientation_corrected = true;
  return next;
}

export function correctSchedulePayload(body = {}) {
  if (!Array.isArray(body?.games)) return body;

  const games = body.games.map(orientFinalScoreToExplicitResult);
  const byTeam = new Map();
  for (const game of games) {
    const teamId = clean(game.reporting_team_id || game.team_id);
    if (!teamId) continue;
    if (!byTeam.has(teamId)) byTeam.set(teamId, []);
    byTeam.get(teamId).push(game);
  }

  const derivedByTeam = new Map();
  for (const [teamId, rows] of byTeam) {
    const derived = recordFromScheduleRows(rows, {
      reportingSchoolId: rows[0]?.school_id || null,
      maxMinutes: 15
    });
    if (Number(derived.scored_finals || 0) <= 0) continue;

    const stored = rows[0] || {};
    const storedCount = stored.wins == null && stored.losses == null && stored.ties == null
      ? -1
      : recordGameCount(stored);
    const derivedCount = recordGameCount(derived);
    if (storedCount > derivedCount) continue;
    derivedByTeam.set(teamId, derived);
  }

  const correctedGames = games.map(game => {
    const teamId = clean(game.reporting_team_id || game.team_id);
    const derived = derivedByTeam.get(teamId);
    if (!derived) return game;
    return {
      ...game,
      wins: derived.wins,
      losses: derived.losses,
      ties: derived.ties,
      scored_finals: derived.scored_finals,
      record_source: "verified-read-derived"
    };
  });

  const statuses = Array.isArray(body.team_statuses)
    ? body.team_statuses.map(status => {
        const derived = derivedByTeam.get(clean(status.team_id));
        if (!derived) return status;
        return {
          ...status,
          overall_record: recordText(derived),
          overall_games: recordGameCount(derived),
          source: "verified-read-derived"
        };
      })
    : body.team_statuses;

  return { ...body, games: correctedGames, team_statuses: statuses };
}

function rewrittenJson(response, body, markerName, markerValue) {
  const headers = new Headers(response.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set(markerName, markerValue);
  headers.delete("content-length");
  return new Response(JSON.stringify(body), {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

async function rewritePublicRead(request, response, env) {
  if (request.method !== "GET" || !response.ok) return response;
  const path = new URL(request.url).pathname;

  if (path === "/api/v1/schools") {
    let body;
    try { body = await response.clone().json(); }
    catch { return response; }
    if (!Array.isArray(body?.schools)) return response;
    body.schools = await applyLogoRelays(request, env, body.schools);
    return rewrittenJson(response, body, "x-localbleachers-logo-delivery", LOGO_DELIVERY_RELEASE);
  }

  const schedulePath = /^\/api\/v1\/(?:schools\/[^/]+|teams\/[^/]+)\/schedule$/.test(path);
  if (schedulePath) {
    let body;
    try { body = await response.clone().json(); }
    catch { return response; }
    if (!Array.isArray(body?.games)) return response;
    return rewrittenJson(
      response,
      correctSchedulePayload(body),
      "x-localbleachers-result-orientation",
      RESULT_ORIENTATION_RELEASE
    );
  }

  return response;
}

function previewHtml() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>LocalBleachersAR college fix preview</title>
<style>
:root{color-scheme:dark;font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#071524;color:#f7f9fc}*{box-sizing:border-box}body{margin:0;background:#071524}.wrap{max-width:780px;margin:auto;padding:22px 16px 50px}.eyebrow{color:#64abf7;font-weight:900;letter-spacing:.16em;font-size:.8rem}.title{font-size:1.8rem;font-weight:900;margin:5px 0 4px}.sub{color:#9badc4;line-height:1.45;margin-bottom:18px}.card{background:#0d2035;border:1px solid #29425f;border-radius:20px;padding:16px;margin:14px 0}.record{display:grid;grid-template-columns:1fr 1fr;gap:10px}.stat{background:#132941;border:1px solid #29425f;border-radius:15px;padding:14px}.label{color:#9badc4;font-size:.7rem;font-weight:900;letter-spacing:.1em}.value{font-size:1.5rem;font-weight:900;margin-top:4px}.game{display:flex;justify-content:space-between;gap:12px;padding:12px 0;border-top:1px solid #29425f}.game:first-child{border-top:0}.score{font-weight:900;white-space:nowrap}.ok{color:#73d49f}.bad{color:#ff8d8d}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px}.school{display:grid;grid-template-columns:54px 1fr;gap:11px;align-items:center;background:#0d2035;border:1px solid #29425f;border-radius:16px;padding:10px}.logo{width:54px;height:54px;border-radius:12px;background:#fff;display:grid;place-items:center;overflow:hidden;color:#0d2035;font-weight:900}.logo img{width:100%;height:100%;object-fit:contain;padding:3px}.name{font-weight:850;font-size:.9rem}.meta{color:#9badc4;font-size:.75rem;margin-top:2px}.section{font-size:1.05rem;font-weight:900;margin:24px 2px 10px}.banner{border:1px solid #31557d;background:#102a46;border-radius:14px;padding:11px 13px;color:#b9cee5;font-size:.8rem}.count{color:#9badc4;font-size:.8rem;margin-left:4px}button{border:1px solid #31557d;background:#142f4d;color:#fff;border-radius:12px;padding:9px 12px;font-weight:800}#error{white-space:pre-wrap}</style>
</head>
<body><main class="wrap">
<div class="eyebrow">BRANCH PREVIEW</div><div class="title">College trust fix</div>
<div class="sub">This page reads the exact Worker branch behind this URL. It does not change production or D1.</div>
<div class="banner">Pass condition: Arkansas football shows <strong>1-1</strong>, Utah renders <strong>L 10-43</strong>, and college logos below render as images instead of initials.</div>
<div id="arkansas" class="card">Loading Arkansas…</div>
<div class="section">Arkansas colleges <span id="count" class="count"></span></div><div id="colleges" class="grid"></div>
<div id="error" class="bad"></div>
</main>
<script>
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
function resultScore(g){return g.status==="FINAL"&&g.team_score!=null&&g.opponent_score!=null?`${g.result||""} ${g.team_score}-${g.opponent_score}`.trim():""}
async function load(){
  const [schoolsRes,scheduleRes]=await Promise.all([
    fetch("/api/v1/schools",{cache:"no-store",headers:{accept:"application/json"}}),
    fetch("/api/v1/schools/uark/schedule",{cache:"no-store",headers:{accept:"application/json"}})
  ]);
  if(!schoolsRes.ok||!scheduleRes.ok) throw new Error(`API ${schoolsRes.status}/${scheduleRes.status}`);
  const schools=await schoolsRes.json(); const schedule=await scheduleRes.json();
  const football=(schedule.team_statuses||[]).find(x=>x.sport==="football"&&String(x.gender||"").toLowerCase()==="men")||(schedule.team_statuses||[]).find(x=>x.sport==="football");
  const games=(schedule.games||[]).filter(x=>x.sport==="football");
  document.getElementById("arkansas").innerHTML=`<div class="record"><div class="stat"><div class="label">ARKANSAS OVERALL</div><div class="value ${football?.overall_record==="1-1"?"ok":"bad"}">${esc(football?.overall_record||"N/A")}</div></div><div class="stat"><div class="label">READ RELEASE</div><div class="value" style="font-size:.9rem">${esc(scheduleRes.headers.get("x-localbleachers-result-orientation")||"missing")}</div></div></div><div style="margin-top:12px">${games.filter(g=>g.status==="FINAL").map(g=>`<div class="game"><div><strong>${g.home_away==="home"?"vs.":"at"} ${esc(g.opponent)}</strong></div><div class="score">${esc(resultScore(g))}</div></div>`).join("")}</div>`;
  const colleges=(schools.schools||[]).filter(x=>x.level==="college").sort((a,b)=>String(a.name).localeCompare(String(b.name)));
  document.getElementById("count").textContent=`${colleges.length} colleges`;
  document.getElementById("colleges").innerHTML=colleges.map(s=>`<div class="school"><div class="logo"><span>${esc(String(s.name||"?").charAt(0))}</span>${s.logo_url?`<img src="${esc(s.logo_url)}" alt="" onload="this.previousElementSibling.style.display='none'" onerror="this.style.display='none'">`:""}</div><div><div class="name">${esc(s.name)}</div><div class="meta">${esc(s.mascot||"")} · ${esc(s.city||"")}</div></div></div>`).join("");
}
load().catch(e=>document.getElementById("error").textContent=`Preview failed: ${e.message||e}`);
</script></body></html>`;
}

export default {
  async fetch(request, env, ctx) {
    const path = new URL(request.url).pathname;
    if (request.method === "GET" && path === COLLEGE_TRUST_PREVIEW_PATH) {
      return new Response(previewHtml(), {
        status: 200,
        headers: { "content-type":"text/html; charset=utf-8", "cache-control":"no-store" }
      });
    }
    return rewritePublicRead(request, await app.fetch(request, env, ctx), env);
  },
  async scheduled(controller, env, ctx) {
    return app.scheduled(controller, env, ctx);
  }
};

export { LOGO_DELIVERY_RELEASE, RESULT_ORIENTATION_RELEASE, previewHtml, rewritePublicRead };
