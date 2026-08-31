const DEFAULT_MAX_PAGES = 50;

export function dragonFlyFeedBaseUrl(sourceUrl) {
  const value=String(sourceUrl||"").trim().replace(/\/+$/,"");
  if (!value) throw new Error("DragonFly source URL is required");
  return /\/\d+$/.test(value) ? value.replace(/\/\d+$/,"") : value;
}

export function dragonFlyPageUrl(sourceUrl,page) {
  const n=Number(page);
  if (!Number.isInteger(n) || n < 0) throw new Error("DragonFly page must be a non-negative integer");
  return `${dragonFlyFeedBaseUrl(sourceUrl)}/${n}`;
}

export function mergeDragonFlyPages(pages,{maxPages=DEFAULT_MAX_PAGES}={}) {
  if (!Array.isArray(pages) || !pages.length) throw new Error("DragonFly feed returned no pages");
  if (pages.length > maxPages) throw new Error(`DragonFly feed exceeded ${maxPages} pages`);
  const schedule=[];
  const seenEventIds=new Set();
  let timestamp=null;
  for (const page of pages) {
    if (!page || !Array.isArray(page.schedule)) throw new Error("DragonFly public feed page is missing schedule[]");
    for (const event of page.schedule) {
      const eventId=String(event?.eventId || event?.id || "").trim();
      if (eventId && seenEventIds.has(eventId)) continue;
      if (eventId) seenEventIds.add(eventId);
      schedule.push(event);
    }
    if (page.timestamp && (!timestamp || String(page.timestamp)>String(timestamp))) timestamp=page.timestamp;
  }
  return {schedule,timestamp,hasNextPage:false,pageCount:pages.length};
}

export function dragonFlyNeedsNextPage(payload,page,{maxPages=DEFAULT_MAX_PAGES}={}) {
  if (!payload || !Array.isArray(payload.schedule)) throw new Error("DragonFly public feed page is missing schedule[]");
  if (!payload.hasNextPage) return false;
  if (page + 1 >= maxPages) throw new Error(`DragonFly public feed still hasNextPage after ${maxPages} pages`);
  return true;
}

export async function fetchDragonFlyPagedPayload(sourceUrl,{fetchFn=globalThis.fetch,headers={},maxPages=DEFAULT_MAX_PAGES}={}) {
  if (typeof fetchFn !== "function") throw new Error("A fetch implementation is required");
  const pages=[];
  for (let page=0; page<maxPages; page++) {
    const url=dragonFlyPageUrl(sourceUrl,page);
    const response=await fetchFn(url,{headers,redirect:"follow"});
    if (!response?.ok) {
      const status=Number(response?.status)||0;
      const error=new Error(`DragonFly HTTP ${status||"error"} on page ${page}`);
      error.httpStatus=status||null;
      throw error;
    }
    let payload;
    try { payload=await response.json(); }
    catch {
      const error=new Error(`DragonFly public feed returned invalid JSON on page ${page}`);
      error.httpStatus=Number(response?.status)||null;
      throw error;
    }
    pages.push(payload);
    if (!dragonFlyNeedsNextPage(payload,page,{maxPages})) {
      const merged=mergeDragonFlyPages(pages,{maxPages});
      return {payload:merged,pageCount:pages.length,httpStatus:Number(response.status)||200};
    }
  }
  throw new Error(`DragonFly public feed exceeded ${maxPages} pages`);
}

export { DEFAULT_MAX_PAGES };
