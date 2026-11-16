// Regression for the production blocker of 15 Nov 2026 (restpilot-ai issue #2):
// Profile > Location > Detect said "Couldn't look up your city" and typing
// "Los Angeles" said "City not found". Cause: the page called two outside
// hosts from the browser (api.bigdatacloud.net, geocoding-api.open-meteo.com)
// that the site's own Content-Security-Policy (connect-src in src/start.ts)
// does not allow, so the browser blocked both and the code read that as
// "no result".
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

const read = (p) => fs.readFileSync(p, "utf8");

function connectSrc() {
  const src = read("src/start.ts");
  const block = src.slice(src.indexOf(`"connect-src 'self'"`), src.indexOf("frame-src"));
  return [...block.matchAll(/"((?:https|wss):\/\/[^"]+)"/g)].map((m) => m[1]);
}

function allowed(host, list) {
  return list.some((entry) => {
    const h = entry.replace(/^(https|wss):\/\//, "");
    return h.startsWith("*.") ? host.endsWith(h.slice(1)) : host === h;
  });
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

// Files that run only on the server may call any host: the browser's policy does not apply to them.
const serverOnly = (p) =>
  /\.server\.tsx?$/.test(p) ||
  /\.functions\.ts$/.test(p) ||
  p.includes(`${path.sep}routes${path.sep}api${path.sep}`) ||
  p.includes(`${path.sep}routes${path.sep}api.`) ||
  p.endsWith(`${path.sep}start.ts`) ||
  p.endsWith(`${path.sep}server.ts`);

test("every outside host that browser code fetches is allowed by connect-src", () => {
  const list = connectSrc();
  assert.ok(list.length > 5, "connect-src list was read");
  const offenders = [];
  for (const file of walk("src").filter((p) => !serverOnly(p))) {
    const text = read(file);
    for (const m of text.matchAll(/fetch\(\s*[`"'](https:\/\/[a-zA-Z0-9.-]+)/g)) {
      const host = new URL(m[1]).host;
      if (!allowed(host, list)) offenders.push(`${file}: ${host}`);
    }
  }
  assert.deepEqual(offenders, [], "browser code calls a host the site's own policy blocks");
});

test("Profile looks a typed city up on the server, not from the browser", () => {
  const profile = read("src/routes/profile.tsx");
  assert.ok(
    !profile.includes("geocoding-api.open-meteo.com"),
    "no direct geocoder call from the page",
  );
  assert.match(profile, /useServerFn\(geocodeWeatherQuery\)/);
  assert.ok(
    allowed("api.bigdatacloud.net", connectSrc()),
    "the Detect reverse lookup host is allowed",
  );
});

test('Profile never says "City not found" when the lookup itself failed', () => {
  const profile = read("src/routes/profile.tsx");
  assert.match(profile, /hit\.status === "unavailable"/);
  assert.match(profile, /isn't responding right now/);
  assert.match(
    profile,
    /mutateAsync\(\{ lat: hit\.lat/,
    "success is announced only after the save resolved",
  );
  assert.match(profile, /PERMISSION_DENIED/, "a denied permission gets its own message");
});

// geocodeLocationDetailed, run for real with a stand-in for the network.
async function loadGeocoder() {
  const src = read("src/lib/weather.server.ts");
  const start = src.indexOf("export type GeocodeResult");
  const js = ts.transpileModule(src.slice(start), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
}

async function withFetch(fake, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = fake;
  try {
    return await fn();
  } finally {
    globalThis.fetch = real;
  }
}

test("geocoder: a match, no match and a failed lookup are three different answers", async () => {
  const { geocodeLocationDetailed, geocodeLocation } = await loadGeocoder();
  const la = {
    results: [
      {
        latitude: 34.05223,
        longitude: -118.24368,
        name: "Los Angeles",
        admin1: "California",
        country_code: "US",
      },
    ],
  };

  let asked = "";
  const ok = await withFetch(
    async (u) => {
      asked = String(u);
      return new Response(JSON.stringify(la));
    },
    () => geocodeLocationDetailed("  Los Angeles "),
  );
  assert.deepEqual(ok, {
    status: "ok",
    lat: 34.05223,
    lon: -118.24368,
    label: "Los Angeles, California, US",
  });
  assert.match(asked, /name=Los%20Angeles&/, "the query is trimmed and encoded");

  assert.deepEqual(
    await withFetch(
      async () => new Response("{}"),
      () => geocodeLocationDetailed("Zzzzqqq"),
    ),
    { status: "not_found" },
  );
  assert.deepEqual(
    await withFetch(
      async () => new Response("busy", { status: 503 }),
      () => geocodeLocationDetailed("Los Angeles"),
    ),
    { status: "unavailable" },
  );
  assert.deepEqual(
    await withFetch(
      async () => {
        throw new TypeError("network");
      },
      () => geocodeLocationDetailed("Los Angeles"),
    ),
    { status: "unavailable" },
  );
  assert.deepEqual(
    await withFetch(
      async () => new Response("<html>"),
      () => geocodeLocationDetailed("Los Angeles"),
    ),
    { status: "unavailable" },
  );

  // The older helper keeps its contract for its other caller (traffic).
  assert.equal(
    await withFetch(
      async () => new Response("{}"),
      () => geocodeLocation("Zzzzqqq"),
    ),
    null,
  );
  assert.deepEqual(
    await withFetch(
      async () => new Response(JSON.stringify(la)),
      () => geocodeLocation("Los Angeles"),
    ),
    { lat: 34.05223, lon: -118.24368, label: "Los Angeles, California, US" },
  );
});

test("the site's Permissions-Policy lets its own pages ask for location", () => {
  const src = read("src/start.ts");
  const line = src.split("\n").find((l) => /^\s*"camera=\(\)/.test(l)) ?? "";
  assert.match(
    line,
    /geolocation=\(self\)/,
    "geolocation=() makes the browser refuse Detect whatever the user allows",
  );
  assert.ok(!/geolocation=\(\)/.test(line));
  assert.ok(!/geolocation=\*/.test(line), "own pages only, never every origin");
});

test('weather and traffic lookups never say "No match found" when the lookup itself failed', () => {
  for (const f of [
    "src/components/weather/WeatherLocationCard.tsx",
    "src/components/traffic/TrafficDestinationsCard.tsx",
  ]) {
    assert.match(read(f), /hit\.reason === "unavailable"/, f);
  }
  const traffic = read("src/lib/traffic/traffic.functions.ts");
  assert.match(traffic, /reason: r\.status/);
  assert.ok(!/const hit = await geocodeLocation\(/.test(traffic));
});

test("Profile gives an over-long city its own message before any lookup", () => {
  const profile = read("src/routes/profile.tsx");
  const tooLong = profile.indexOf("q.length > 80");
  assert.ok(tooLong > 0 && tooLong < profile.indexOf("await geocodeCity(q)"));
});

// A loader that fetches a host through a constant (not a literal fetch("https://...")) is
// governed by connect-src too: KTX2Loader.setTranscoderPath() downloads the Basis
// transcoder with fetch (FileLoader), and useGLTF()/GLTFLoader do the same for model files.
// KNOWN DEFECT (reported, not fixed here): Avatar3D.tsx points the transcoder at
// cdn.jsdelivr.net, which is in script-src but NOT connect-src, so the browser blocks it. It
// only matters for a KTX2-compressed model (there is no default 3D model; only a QA override).
// The test pins the exact known set: a new offender fails, and fixing this one makes the
// test ask for its entry to be removed.
test("loader paths held in constants point at hosts connect-src allows (known offenders pinned)", () => {
  const list = connectSrc();
  const KNOWN = new Set(["src/components/companion/Avatar3D.tsx: cdn.jsdelivr.net"]);
  const found = new Set();
  for (const file of walk("src").filter((p) => !serverOnly(p))) {
    const text = read(file);
    for (const call of text.matchAll(
      /\b(?:setTranscoderPath|setPath|setDecoderPath)\(\s*([A-Za-z_][\w]*|["'`]https:\/\/[^"'`]+)/g,
    )) {
      const arg = call[1];
      let url =
        arg.startsWith('"') || arg.startsWith("'") || arg.startsWith("`") ? arg.slice(1) : null;
      if (!url) {
        const decl = text.match(
          new RegExp(`\\b${arg}\\b\\s*(?::[^=]+)?=\\s*[\\r\\n\\s]*["'\`](https://[^"'\`]+)`),
        );
        url = decl?.[1] ?? null;
      }
      if (!url) continue;
      const host = new URL(url).host;
      if (!allowed(host, list)) found.add(`${file.split(path.sep).join("/")}: ${host}`);
    }
  }
  assert.deepEqual([...found].sort(), [...KNOWN].sort());
});
