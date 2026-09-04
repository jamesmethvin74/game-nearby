import { parseInstitutionalScheduleHtml } from "./institutional-schedule-html.js";
import { normalizePrestoSportsRss } from "./prestosports-rss.js";

const COLLEGE_RUNTIME_PARSERS = new Set(["prestosports-rss", "institutional-table"]);

export function isCollegeRuntimeParser(parserType) {
  return COLLEGE_RUNTIME_PARSERS.has(String(parserType || ""));
}

export function sharedCollegeFetchKey(source) {
  if (source?.parser_type !== "prestosports-rss") return null;
  const url = String(source?.source_url || "").trim();
  return url ? `prestosports-rss:${url}` : null;
}

async function fetchText(source, { fetchFn, userAgent, conditional = true } = {}) {
  const headers = {
    "user-agent": userAgent,
    "accept": source.parser_type === "prestosports-rss"
      ? "application/rss+xml,application/xml,text/xml;q=0.9,*/*;q=0.5"
      : "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5"
  };
  if (conditional && source.etag) headers["if-none-match"] = source.etag;
  if (conditional && source.last_modified) headers["if-modified-since"] = source.last_modified;

  const response = await fetchFn(source.source_url, { headers, redirect:"follow" });
  if (response.status === 304) {
    return {
      notModified:true,status:304,body:"",contentType:"",
      etag:source.etag || null,lastModified:source.last_modified || null,pagesFetched:null
    };
  }
  if (!response.ok) {
    const error = new Error(`HTTP ${response.status}`);
    error.httpStatus = response.status;
    throw error;
  }
  return {
    notModified:false,
    status:response.status,
    body:await response.text(),
    contentType:response.headers.get("content-type") || "",
    etag:response.headers.get("etag"),
    lastModified:response.headers.get("last-modified"),
    pagesFetched:null
  };
}

export async function fetchCollegeSourceMaterial(source, sharedFetches, { fetchFn = fetch, userAgent = "LocalBleachersAR/2.0" } = {}) {
  if (!isCollegeRuntimeParser(source?.parser_type)) return null;

  const sharedKey = sharedCollegeFetchKey(source);
  if (!sharedKey) return fetchText(source, { fetchFn, userAgent, conditional:true });

  let pending = sharedFetches?.get(sharedKey);
  if (!pending) {
    // Composite RSS can back several team rows. Use one unconditional provider
    // request per Worker collection batch so every team sees the same body and
    // a 304 tied to one row's validator cannot suppress sibling teams.
    pending = fetchText(source, { fetchFn, userAgent, conditional:false });
    sharedFetches?.set(sharedKey, pending);
  }
  return pending;
}

export async function parseCollegeSourceBody(body, source, { HTMLRewriterClass = globalThis.HTMLRewriter } = {}) {
  if (source?.parser_type === "prestosports-rss") return normalizePrestoSportsRss(body, source);
  if (source?.parser_type === "institutional-table") return parseInstitutionalScheduleHtml(body, source, HTMLRewriterClass);
  return null;
}
