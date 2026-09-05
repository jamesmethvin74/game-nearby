import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { applyVerifiedBrandAssets } from "../src/catalog-identity-worker.js";
import { cacheDescriptor, SCHOOL_CATALOG_CACHE_VERSION } from "../src/public-cors-worker.js";
import { isAppRenderableLogoUrl, probeCollegeLogoUrl } from "../src/college-logo-bootstrap.js";

test("public school catalog overlays one set-based verified branding lookup", async () => {
  let calls = 0;
  let payload = null;
  const env = {
    DB: {
      prepare(sql) {
        assert.match(sql, /FROM school_brand_assets/);
        assert.match(sql, /status IN \('matched','curated'\)/);
        return {
          bind(value) {
            calls++;
            payload = JSON.parse(value);
            return {
              async all() {
                return {
                  results: [
                    { school_id:"asu-mid-south", logo_url:"https://example.edu/greyhounds.png", mascot:"Greyhounds", status:"curated" }
                  ]
                };
              }
            };
          }
        };
      }
    }
  };
  const schools = [
    { id:"asu-mid-south", name:"Arkansas State University Mid-South", logo_url:null, mascot:null },
    { id:"arkansas-state", name:"Arkansas State University", logo_url:"https://example.edu/redwolves.png", mascot:"Red Wolves" }
  ];
  const result = await applyVerifiedBrandAssets(env, schools);
  assert.equal(calls, 1, "branding overlay must remain one bounded set-based query");
  assert.deepEqual(payload, ["asu-mid-south", "arkansas-state"]);
  assert.equal(result[0].logo_url, "https://example.edu/greyhounds.png");
  assert.equal(result[0].mascot, "Greyhounds");
  assert.equal(result[1].logo_url, "https://example.edu/redwolves.png");
});

test("school catalog edge cache is versioned and no longer six hours fresh", () => {
  assert.equal(SCHOOL_CATALOG_CACHE_VERSION, "logo-render-v1");
  const request = new Request("https://example.test/api/v1/schools");
  const descriptor = cacheDescriptor(request);
  assert.ok(descriptor);
  assert.equal(descriptor.freshTtl, 5 * 60);
  assert.equal(descriptor.staleTtl, 6 * 60 * 60);
  assert.match(descriptor.freshKey.url, /schools\/logo-render-v1/);
});

test("college logo completion accepts only an HTTPS URL that actually returns an image", async () => {
  assert.equal(isAppRenderableLogoUrl("http://example.edu/logo.png"), false);
  assert.equal(isAppRenderableLogoUrl("https://example.edu/logo.png"), true);

  const good = await probeCollegeLogoUrl("https://example.edu/logo.png", async () => new Response("image", {
    status:200,
    headers:{ "content-type":"image/png" }
  }));
  assert.equal(good.contentType, "image/png");

  await assert.rejects(
    () => probeCollegeLogoUrl("https://example.edu/logo.png", async () => new Response("html", {
      status:200,
      headers:{ "content-type":"text/html" }
    })),
    /logo content-type text\/html/
  );
  await assert.rejects(() => probeCollegeLogoUrl("http://example.edu/logo.png", async () => new Response()), /not HTTPS/);
});

test("explicit college audit IDs are not restricted to SQL-null logo rows", () => {
  const source = fs.readFileSync(new URL("../src/college-logo-bootstrap.js", import.meta.url), "utf8");
  assert.match(source, /targets = colleges\.filter\(row => wanted\.has\(row\.id\)\)/);
  assert.match(source, /probeCollegeLogoUrl\(candidate\.url, fetchFn\)/);
  assert.doesNotMatch(source, /COALESCE\(NULLIF\(b\.logo_url,''\),NULLIF\(s\.logo_url,''\)\) IS NULL/);
});
