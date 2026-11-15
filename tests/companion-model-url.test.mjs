import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { resolveModelUrl } from "../src/lib/companion/model-url.ts";

test("there is no default 3D model: no override means no model (2D portrait)", () => {
  assert.equal(resolveModelUrl(null), null);
  assert.equal(resolveModelUrl(undefined), null);
  assert.equal(resolveModelUrl("   "), null);
});

test("a stale Ready Player Me override never reaches the dead host", () => {
  for (const u of [
    "https://models.readyplayer.me/64bfa15f0e72c63d7c3934a6.glb",
    "https://models.readyplayer.me/abc.glb?morphTargets=ARKit",
    "https://READYPLAYER.ME/x.glb",
  ]) {
    assert.equal(resolveModelUrl(u), null, u);
  }
});

test("malformed or insecure overrides are ignored; https and same-origin paths are kept", () => {
  assert.equal(resolveModelUrl("not a url"), null);
  assert.equal(resolveModelUrl("http://example.com/head.glb"), null);
  assert.equal(resolveModelUrl("//example.com/head.glb"), null);
  assert.equal(
    resolveModelUrl("https://cdn.example.com/head.glb"),
    "https://cdn.example.com/head.glb",
  );
  assert.equal(
    resolveModelUrl("/__l5e/assets-v1/x/companion-default.glb"),
    "/__l5e/assets-v1/x/companion-default.glb",
  );
});

test("no source file still requests models.readyplayer.me", () => {
  const files = [
    "../src/lib/companion/avatar-models.ts",
    "../src/routes/settings.companion.tsx",
    "../src/start.ts",
  ];
  for (const f of files) {
    const src = fs.readFileSync(new URL(f, import.meta.url), "utf8");
    assert.doesNotMatch(src, /https:\/\/models\.readyplayer\.me/, f);
  }
});
