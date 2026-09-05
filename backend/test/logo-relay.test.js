import assert from "node:assert/strict";
import test from "node:test";
import {
  PERSISTENT_LOGO_RELAY_SCHOOL_IDS,
  applyLogoRelays,
  handleLogoRelay,
  logoRelayUrl,
  sniffImageContentType
} from "../src/catalog-identity-worker.js";

const ENV = { REFRESH_TOKEN: "test-logo-relay-secret" };
const REQUEST = new Request("https://sports.example/api/v1/schools");

test("persistent logo relay allowlist is exactly the proven 13-school failure set", () => {
  assert.deepEqual([...PERSISTENT_LOGO_RELAY_SCHOOL_IDS].sort(), [
    "aaa-ptzw9n",
    "asu-mid-south",
    "asu-mountain-home",
    "asu-newport",
    "cbc",
    "champion-christian",
    "df-6blldr",
    "philander-smith",
    "sau-tech",
    "shorter",
    "south-arkansas",
    "ua-cossatot",
    "uark"
  ]);
});

test("catalog rewrites only allowlisted HTTPS logos to signed same-origin relay URLs", async () => {
  const rows = await applyLogoRelays(REQUEST, ENV, [
    { id: "uark", logo_url: "https://cdn.example/uark.png" },
    { id: "uca", logo_url: "https://cdn.example/uca.png" },
    { id: "asu-mid-south", logo_url: "http://cdn.example/insecure.png" }
  ]);
  const relay = new URL(rows[0].logo_url);
  assert.equal(relay.origin, "https://sports.example");
  assert.equal(relay.pathname, "/api/v1/logo-relay/uark");
  assert.equal(relay.searchParams.get("src"), "https://cdn.example/uark.png");
  assert.match(relay.searchParams.get("sig"), /^[0-9a-f]{32}$/);
  assert.equal(rows[1].logo_url, "https://cdn.example/uca.png");
  assert.equal(rows[2].logo_url, "http://cdn.example/insecure.png");
});

test("non-allowlisted schools cannot create relay URLs", async () => {
  assert.equal(await logoRelayUrl(REQUEST, ENV, "uca", "https://cdn.example/uca.png"), null);
});

test("relay validates signature, never reads D1, and returns a cacheable image", async () => {
  const relayUrl = await logoRelayUrl(REQUEST, ENV, "uark", "https://cdn.example/uark.png");
  let fetches = 0;
  const env = {
    REFRESH_TOKEN: ENV.REFRESH_TOKEN,
    get DB() { throw new Error("relay must not read D1"); }
  };
  const png = new Uint8Array([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0,0,0,0]);
  const response = await handleLogoRelay(new Request(relayUrl), env, null, async () => {
    fetches += 1;
    return new Response(png, { status: 200, headers: { "content-type": "application/octet-stream" } });
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/png");
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
  assert.equal(response.headers.get("x-localbleachers-logo-relay"), "1");
  assert.match(response.headers.get("cache-control"), /max-age=86400/);
  assert.equal(fetches, 1);
});

test("relay rejects a bad signature without fetching upstream", async () => {
  const relayUrl = new URL(await logoRelayUrl(REQUEST, ENV, "uark", "https://cdn.example/uark.png"));
  relayUrl.searchParams.set("sig", "0".repeat(32));
  let fetched = false;
  const response = await handleLogoRelay(new Request(relayUrl), ENV, null, async () => {
    fetched = true;
    return new Response("should not happen");
  });
  assert.equal(response.status, 404);
  assert.equal(fetched, false);
});

test("relay refuses upstream non-images", async () => {
  const relayUrl = await logoRelayUrl(REQUEST, ENV, "uark", "https://cdn.example/uark.png");
  const response = await handleLogoRelay(new Request(relayUrl), ENV, null, async () =>
    new Response("not an image", { status: 200, headers: { "content-type": "text/html" } })
  );
  assert.equal(response.status, 502);
});

test("image sniffing accepts common binary image signatures and SVG", () => {
  assert.equal(sniffImageContentType(new Uint8Array([0xff,0xd8,0xff,0]), "https://x/logo", "application/octet-stream"), "image/jpeg");
  assert.equal(sniffImageContentType(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'></svg>"), "https://x/logo", "text/plain"), "image/svg+xml");
});
