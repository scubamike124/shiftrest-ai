// The iPhone app identifies itself with "RestPilotApp/<version>" at the end of
// the WebView user agent (Capacitor appendUserAgent). Server and site code use
// the "RestPilotApp/" token as the native-app marker, so it must exist and
// match the app's marketing version.
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (p) => fs.readFileSync(new URL("../" + p, import.meta.url), "utf8");

test("the app shell appends RestPilotApp/<marketing version> to its user agent", () => {
  const config = JSON.parse(read("ios-app/capacitor.config.json"));
  const versions = [
    ...read("ios-app/ios/App/App.xcodeproj/project.pbxproj").matchAll(
      /MARKETING_VERSION = ([^;]+);/g,
    ),
  ].map((m) => m[1]);
  assert.ok(versions.length >= 1);
  assert.equal(new Set(versions).size, 1, "Debug and Release share one marketing version");
  assert.equal(config.appendUserAgent, `RestPilotApp/${versions[0]}`);
  assert.equal(
    config.ios?.overrideUserAgent ?? config.overrideUserAgent,
    undefined,
    "append, never replace",
  );
});
