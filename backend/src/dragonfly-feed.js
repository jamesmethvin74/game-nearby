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
  let timestamp=null;
  for (const page of pages) {
    if (!page || !Array.isArray(page.schedule)) throw new Error("DragonFly public feed page is missing schedule[]");
    schedule.push(...page.schedule);
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

export { DEFAULT_MAX_PAGES };
