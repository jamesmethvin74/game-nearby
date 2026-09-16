import test from "node:test";

function clean(value) { return String(value ?? "").trim(); }
function decodeHtml(value) {
  return clean(value)
    .replace(/\\u0026/g,"&")
    .replace(/\\\//g,"/")
    .replace(/&amp;/g,"&")
    .replace(/&#x2F;/gi,"/")
    .replace(/&quot;/g,'"');
}
function resolveCandidate(raw, pageUrl) {
  let value = decodeHtml(raw).replace(/^['"]|['"]$/g,"");
  if (!value || value.startsWith("data:")) return "";
  try {
    const url = new URL(value, pageUrl);
    return url.protocol === "https:" ? url.toString() : "";
  } catch { return ""; }
}
function score(url) {
  const v = url.toLowerCase();
  let n = 0;
  if (/logo/.test(v)) n += 12;
  if (/school|high_school|high-school|mustang|pioneer|friendship|exalt|st.?paul|saint/.test(v)) n += 5;
  if (/header|brand|identity|mark/.test(v)) n += 4;
  if (/favicon|apple-touch/.test(v)) n -= 8;
  if (/gallery|hero|slider|banner|news|photo/.test(v)) n -= 6;
  if (/\.svg(?:\?|$)/.test(v)) n += 2;
  if (/\.(?:png|webp|jpe?g)(?:\?|$)/.test(v)) n += 1;
  return n;
}
function extractCandidates(html, pageUrl) {
  const found = new Set();
  const patterns = [
    /<(?:img|source)[^>]+(?:src|data-src|srcset)=["']([^"']+)["']/gi,
    /<meta[^>]+(?:content)=["']([^"']+)["'][^>]*(?:og:image|twitter:image|image)/gi,
    /<meta[^>]+(?:og:image|twitter:image|image)[^>]+content=["']([^"']+)["']/gi,
    /["'](https:\\?\/\\?\/[^"'<>\s]+?\.(?:png|webp|jpe?g|gif|svg)(?:\?[^"'<>\s]*)?)["']/gi,
    /["']([^"']*(?:logo|Logo|LOGO)[^"']*\.(?:png|webp|jpe?g|gif|svg)(?:\?[^"']*)?)["']/gi
  ];
  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) {
      const raw = clean(match[1]).split(/\s+/)[0];
      const url = resolveCandidate(raw, pageUrl);
      if (url) found.add(url);
    }
  }
  return [...found].sort((a,b)=>score(b)-score(a)).slice(0,40);
}
async function probe(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
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

const PAGES = {
  cbc:"https://cbcmustangs.com/",
  crowleys_ridge:"https://crcpioneers.com/",
  exalt:"https://www.exaltacademies.org/exalt-academy-high-school",
  friendship:"https://friendshipaspire.org/",
  st_paul:"https://www.huntsvilleschooldistrict.org/o/sphs"
};

test("extract current renderable logo candidates from official pages", {timeout:120000}, async () => {
  for (const [id,pageUrl] of Object.entries(PAGES)) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    let html = "";
    let status = null;
    try {
      const r = await fetch(pageUrl, {redirect:"follow",headers:{accept:"text/html,application/xhtml+xml","user-agent":"Mozilla/5.0 LocalBleachersAR official-logo discovery"},signal:controller.signal});
      status = r.status;
      html = await r.text();
    } catch (error) {
      console.log(`OFFICIAL_PAGE_FAIL id=${id} url=${pageUrl} error=${String(error?.name || error?.message || error)}`);
    } finally { clearTimeout(timer); }
    console.log(`OFFICIAL_PAGE id=${id} status=${status} bytes=${html.length} url=${pageUrl}`);
    const candidates = extractCandidates(html,pageUrl);
    let emitted = 0;
    for (const url of candidates) {
      const result = await probe(url);
      if (!result.ok) continue;
      console.log(`OFFICIAL_LOGO_CANDIDATE id=${id} score=${score(url)} type=${result.type} url=${url}`);
      emitted += 1;
      if (emitted >= 8) break;
    }
  }

  const known = {
    uark:"https://a.espncdn.com/i/teamlogos/ncaa/500/8.png",
    friendship_current:"https://friendshipaspire.org/wp-content/uploads/2023/08/Friendship-1.svg",
    exalt_current:"https://d14tal8bchn59o.cloudfront.net/MuhtYnB_DVaIREfG1kwbGiLG003XgAwJXm1zB3SxVo4/w%3A960/plain/https%3A//02f0a56ef46d93f03c90-22ac5f107621879d5667e0d7ed595bdb.ssl.cf2.rackcdn.com/sites/85099/photos/22517366/High_School_Logo-100_original.jpg"
  };
  for (const [id,url] of Object.entries(known)) {
    console.log(`KNOWN_LOGO_CANDIDATE id=${id} probe=${JSON.stringify(await probe(url))} url=${url}`);
  }
});
