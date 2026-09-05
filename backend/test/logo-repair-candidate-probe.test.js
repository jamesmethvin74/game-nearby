import test from "node:test";
import { parseMaxPrepsSchoolDirectory } from "../src/school-branding.js";

const DIRS = [
  "https://www.maxpreps.com/ar/schools/",
  "https://www.maxpreps.com/ar/basketball/schools/",
  "https://www.maxpreps.com/ar/volleyball/schools/"
];

function clean(value) { return String(value ?? "").trim(); }

async function probe(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const r = await fetch(url, {
      method:"GET",
      redirect:"follow",
      headers:{accept:"image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8","user-agent":"Mozilla/5.0 LocalBleachersAR repair probe"},
      signal:controller.signal
    });
    const type = clean(r.headers.get("content-type")).toLowerCase();
    return { ok:r.ok && type.startsWith("image/"), status:r.status, type, finalUrl:clean(r.url) || url };
  } catch (error) {
    return { ok:false, status:null, type:null, error:String(error?.name || error?.message || error) };
  } finally { clearTimeout(timer); }
}

test("discover exact MaxPreps replacement assets and college site-logo candidates", {timeout:120000}, async () => {
  const all = [];
  for (const url of DIRS) {
    try {
      const r = await fetch(url, {headers:{"user-agent":"Mozilla/5.0 LocalBleachersAR repair probe",accept:"text/html"}});
      const html = await r.text();
      all.push(...parseMaxPrepsSchoolDirectory(html));
    } catch (error) {
      console.log(`REPAIR_DIR_FAIL url=${url} error=${String(error?.message || error)}`);
    }
  }
  const unique = new Map(all.map(row => [row.externalSchoolId,row]));
  const entries = [...unique.values()];
  for (const needle of ["exalt","friendship aspire","st. paul","st paul"]) {
    const matches = entries.filter(row => clean(row.name).toLowerCase().includes(needle));
    for (const row of matches) console.log(`REPAIR_MAXPREPS needle=${JSON.stringify(needle)} name=${JSON.stringify(row.name)} city=${JSON.stringify(row.city)} id=${row.externalSchoolId} logo=${row.logoUrl} source=${row.sourceUrl}`);
  }

  const candidates = {
    uark:"https://a.espncdn.com/i/teamlogos/ncaa/500/8.png",
    cbc:"https://cbcmustangs.com/images/logos/site/site.png",
    crowleys_ridge:"https://crcpioneers.com/images/logos/site/site.png"
  };
  for (const [id,url] of Object.entries(candidates)) {
    console.log(`REPAIR_COLLEGE_CANDIDATE id=${id} url=${url} probe=${JSON.stringify(await probe(url))}`);
  }
});
