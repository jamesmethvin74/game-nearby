import test from "node:test";
import assert from "node:assert/strict";
import { normalizePrestoSportsRss } from "../src/prestosports-rss.js";

const BASE = "https://cbcmustangs.com/sports/mbkb/2026-27/schedule";
const ROUTES = [
  {kind:"html",url:BASE,accept:"text/html,application/xhtml+xml"},
  {kind:"rss",url:`${BASE}?print=rss`,accept:"application/rss+xml,application/xml,text/xml,*/*;q=0.5"},
  {kind:"ical",url:`${BASE}?print=ical`,accept:"text/calendar,text/plain,*/*;q=0.5"}
];

async function probe(route) {
  try {
    const response = await fetch(route.url, {
      redirect:"follow",
      headers:{
        "user-agent":"LocalBleachersAR/2.0 (+https://github.com/jamesmethvin74/game-nearby)",
        "accept":route.accept
      },
      signal:AbortSignal.timeout(15000)
    });
    const body = await response.text();
    const report = {
      kind:route.kind,
      url:route.url,
      status:response.status,
      contentType:response.headers.get("content-type") || "",
      bytes:body.length,
      hasSeason:/2026-27|2026\s*[-–]\s*27/i.test(body),
      hasOctober:/Oct(?:ober)?\s+(?:20|23)|2026-10-(?:20|23)/i.test(body),
      cloudflareChallenge:/Just a moment|cf-chl|challenge-platform|Attention Required/i.test(body)
    };
    if (response.ok && route.kind === "rss") {
      try {
        report.parsedGames = normalizePrestoSportsRss(body, {
          parser_type:"prestosports-rss",sport:"basketball",gender:"men",season:"2026",
          home_venue:"",home_latitude:null,home_longitude:null
        }).length;
      } catch (error) {
        report.parseError = String(error?.message || error);
      }
    }
    console.log("CBC_M4_LIVE_PROOF", JSON.stringify(report));
    return report;
  } catch (error) {
    const report = {kind:route.kind,url:route.url,status:"ERROR",error:String(error?.message || error)};
    console.log("CBC_M4_LIVE_PROOF", JSON.stringify(report));
    return report;
  }
}

test("TEMP: CBC men's basketball has at least one direct server-fetchable 2026-27 route", async () => {
  const reports = [];
  for (const route of ROUTES) reports.push(await probe(route));
  const usable = reports.filter(row => Number(row.status) >= 200 && Number(row.status) < 300 && row.hasSeason && !row.cloudflareChallenge);
  assert.ok(usable.length > 0, `CBC routes not directly usable: ${JSON.stringify(reports)}`);
});
