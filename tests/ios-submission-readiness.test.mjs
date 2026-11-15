// Static checks for the App Store submission files in ios-app/ (no Xcode needed).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = "ios-app/ios/App/";
const read = (p) => readFileSync(p, "utf8");
const infoPlist = read(app + "App/Info.plist");
const manifest = read(app + "App/PrivacyInfo.xcprivacy");
const entitlements = read(app + "App/App.entitlements");
const pbxproj = read(app + "App.xcodeproj/project.pbxproj");

test("purpose strings are final (no DRAFT marker) and cover every permission the app uses", () => {
  assert.doesNotMatch(infoPlist, /DRAFT|owner to approve/i);
  for (const key of ["NSMicrophoneUsageDescription", "NSLocationWhenInUseUsageDescription", "NSHealthShareUsageDescription"]) {
    const m = infoPlist.match(new RegExp(`<key>${key}</key>\\s*<string>([^<]+)</string>`));
    assert.ok(m && m[1].length > 60, `${key} needs a specific purpose string`);
  }
  // The app never writes to Health, uses no camera, photos or speech recognition.
  assert.doesNotMatch(infoPlist, /NSHealthUpdateUsageDescription|NSCameraUsageDescription|NSPhotoLibrary|NSSpeechRecognition/);
});

test("privacy manifest: no tracking, UserDefaults reason declared, shipped in the app bundle", () => {
  assert.match(manifest, /<key>NSPrivacyTracking<\/key>\s*<false\/>/);
  assert.match(manifest, /<key>NSPrivacyTrackingDomains<\/key>\s*<array\/>/);
  assert.match(manifest, /NSPrivacyAccessedAPICategoryUserDefaults[\s\S]*CA92\.1/);
  assert.doesNotMatch(manifest, /NSPrivacyCollectedDataTypeHealth|NSPrivacyCollectedDataTypePreciseLocation/);
  assert.match(pbxproj, /PrivacyInfo\.xcprivacy in Resources/);
});

test("entitlements: HealthKit only (IAP needs no entitlement file key)", () => {
  assert.match(entitlements, /com\.apple\.developer\.healthkit/);
  assert.doesNotMatch(entitlements, /push|associated-domains|icloud|applesignin/i);
});
