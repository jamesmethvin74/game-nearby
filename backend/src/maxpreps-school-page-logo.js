import { normalizeSchoolAlias } from "./schedule-authority-core.js";
import { normalizeMaxPrepsLogoUrl } from "./school-branding.js";

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function decodeHtml(value) {
  return clean(value)
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&nbsp;/g, " ");
}

function attr(attrs, name) {
  const match = String(attrs || "").match(new RegExp(`\\b${name}=(?:"([^"]*)"|'([^']*)')`, "i"));
  return decodeHtml(match?.[1] ?? match?.[2] ?? "");
}

function maxPrepsPageUrl(href) {
  const value = clean(href);
  if (!value) return "";
  try {
    const url = new URL(value.startsWith("http") ? value : `https://www.maxpreps.com${value}`);
    if (url.hostname !== "www.maxpreps.com" || !url.pathname.startsWith("/ar/")) return "";
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length < 3) return "";
    // School home pages have /ar/<city>/<school-slug>/; sport pages have additional segments.
    url.pathname = `/${parts.slice(0, 3).join("/")}/`;
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

export function parseMaxPrepsSchoolLinks(html) {
  const text = String(html || "");
  const rows = [];
  const seen = new Set();
  for (const match of text.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const attrs = match[1];
    const body = match[2];
    const sourceUrl = maxPrepsPageUrl(attr(attrs, "href"));
    if (!sourceUrl || seen.has(sourceUrl)) continue;
    const title = body.match(/<div\b[^>]*class=(?:"[^"]*\btitle\b[^"]*"|'[^']*\btitle\b[^']*')[^>]*>([^<]+)<\/div>/i);
    const description = body.match(/<div\b[^>]*class=(?:"[^"]*\bdescription\b[^"]*"|'[^']*\bdescription\b[^']*')[^>]*>([^<]+)<\/div>/i);
    const name = decodeHtml(title?.[1] || attr(attrs, "title"));
    const location = decodeHtml(description?.[1] || "");
    const city = clean(location.split(",")[0]);
    if (!name || !city) continue;
    seen.add(sourceUrl);
    rows.push({ name, city, location, logoUrl:"", sourceUrl });
  }
  return rows;
}

function candidateKeys(hints = {}) {
  return [...new Set([
    hints.name,
    hints.sourceName,
    hints.locationMatchedName
  ].map(normalizeSchoolAlias).filter(Boolean))];
}

function labelScore(label, keys) {
  const normalized = normalizeSchoolAlias(label);
  if (!normalized) return 0;
  let score = 0;
  for (const key of keys) {
    if (normalized === key) score = Math.max(score, 100);
    else if (normalized.startsWith(`${key} `) || key.startsWith(`${normalized} `)) score = Math.max(score, 80);
    else if (normalized.includes(key) || key.includes(normalized)) score = Math.max(score, 60);
  }
  return score;
}

export function parseMaxPrepsSchoolPageLogo(html, hints = {}) {
  const text = String(html || "");
  const keys = candidateKeys(hints);
  const candidates = [];
  const seen = new Set();

  for (const match of text.matchAll(/<img\b([^>]*)>/gi)) {
    const attrs = match[1];
    const rawSources = [attr(attrs, "src"), attr(attrs, "data-src")];
    const srcset = attr(attrs, "srcset");
    if (srcset) rawSources.push(...srcset.split(",").map(item => item.trim().split(/\s+/)[0]));
    const label = attr(attrs, "alt") || attr(attrs, "title") || attr(attrs, "aria-label");
    for (const raw of rawSources) {
      const logoUrl = normalizeMaxPrepsLogoUrl(raw);
      if (!logoUrl || seen.has(logoUrl)) continue;
      seen.add(logoUrl);
      candidates.push({ logoUrl, label, score:labelScore(label, keys) });
    }
  }

  // Some pages expose the school logo in embedded JSON rather than a visible img tag.
  for (const match of text.matchAll(/https:\\/\\/image\.maxpreps\.io\\/school-mascot\\/[^"'\\s<]+/gi)) {
    const raw = match[0].replace(/\\\//g, "/");
    const logoUrl = normalizeMaxPrepsLogoUrl(raw);
    if (!logoUrl || seen.has(logoUrl)) continue;
    seen.add(logoUrl);
    candidates.push({ logoUrl, label:"", score:0 });
  }

  candidates.sort((a, b) => b.score - a.score);
  if (candidates[0]?.score >= 60) return { logoUrl:candidates[0].logoUrl, method:"school-page-labeled-image" };
  if (candidates.length === 1) return { logoUrl:candidates[0].logoUrl, method:"school-page-single-mascot-image" };
  return null;
}
