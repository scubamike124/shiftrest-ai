// Static checks for the App Store submission files in ios-app/ (no Xcode needed).
// Files are read from IOS_APP_DIR (default ios-app/ios/App/) so the checks can be
// pointed at a scratch copy to prove they fail on bad input.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = process.env.IOS_APP_DIR ?? "ios-app/ios/App/";
const read = (p) => readFileSync(app + p, "utf8");

/** Strict XML plist parser: dict, array, string, true, false, integer, real, data, date. Throws on anything malformed. */
export function parsePlist(xml) {
  const src = xml.replace(/<\?xml[^>]*\?>/, "").replace(/<!DOCTYPE[^>]*>/, "").replace(/<!--[\s\S]*?-->/g, "");
  const re = /<(\/?)([A-Za-z]+)(?:\s+[^<>/]*)?\s*(\/?)>|([^<]+)/g;
  const toks = [];
  let m;
  let last = 0;
  while ((m = re.exec(src))) {
    if (m.index !== last) throw new Error("malformed plist: stray '<' near " + src.slice(last, last + 30));
    last = re.lastIndex;
    if (m[4] !== undefined) { if (m[4].trim()) toks.push({ text: m[4] }); } else toks.push({ close: !!m[1], tag: m[2], self: !!m[3] });
  }
  if (last !== src.length) throw new Error("malformed plist: trailing garbage");
  let i = 0;
  const next = () => { if (i >= toks.length) throw new Error("malformed plist: unexpected end"); return toks[i++]; };
  const expectClose = (tag) => { const t = next(); if (!t.close || t.tag !== tag) throw new Error(`malformed plist: expected </${tag}>`); };
  const value = () => {
    const t = next();
    if (t.text !== undefined || t.close) throw new Error("malformed plist: expected a value");
    switch (t.tag) {
      case "true": return t.self ? true : (expectClose("true"), true);
      case "false": return t.self ? false : (expectClose("false"), false);
      case "string": case "integer": case "real": case "date": case "data": {
        if (t.self) return "";
        const n = toks[i];
        let text = "";
        if (n && n.text !== undefined) { text = n.text; i++; }
        expectClose(t.tag);
        return text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
      }
      case "array": { const out = []; if (t.self) return out; while (!(toks[i]?.close && toks[i].tag === "array")) out.push(value()); i++; return out; }
      case "dict": {
        const out = {};
        if (t.self) return out;
        while (!(toks[i]?.close && toks[i].tag === "dict")) {
          const k = next();
          if (k.tag !== "key" || k.close) throw new Error("malformed plist: expected <key>");
          const kt = next();
          if (kt.text === undefined) throw new Error("malformed plist: empty key");
          expectClose("key");
          out[kt.text] = value();
        }
        i++;
        return out;
      }
      default: throw new Error("malformed plist: unknown element " + t.tag);
    }
  };
  const root = next();
  if (root.tag !== "plist" || root.close) throw new Error("malformed plist: no <plist>");
  const v = value();
  expectClose("plist");
  if (i !== toks.length) throw new Error("malformed plist: content after </plist>");
  return v;
}

const info = parsePlist(read("App/Info.plist"));
const manifest = parsePlist(read("App/PrivacyInfo.xcprivacy"));
const entitlements = parsePlist(read("App/App.entitlements"));
const pbxproj = read("App.xcodeproj/project.pbxproj");

test("Info.plist purpose strings: exactly the three the app uses, final wording", () => {
  const keys = Object.keys(info).filter((k) => /UsageDescription$/.test(k)).sort();
  assert.deepEqual(keys, ["NSHealthShareUsageDescription", "NSLocationWhenInUseUsageDescription", "NSMicrophoneUsageDescription"]);
  for (const k of keys) {
    assert.ok(info[k].length > 60, `${k} needs a specific purpose string`);
    assert.doesNotMatch(info[k], /DRAFT|owner to approve/i);
  }
  assert.doesNotMatch(info.NSLocationWhenInUseUsageDescription, /approximate|coarse/i, "the app stores precise coordinates");
});

test("Info.plist: export compliance answered, arm64 only, no healthkit device requirement", () => {
  assert.equal(info.ITSAppUsesNonExemptEncryption, false);
  assert.deepEqual(info.UIRequiredDeviceCapabilities, ["arm64"]);
});

test("privacy manifest: no tracking, UserDefaults reason, expected collected types", () => {
  assert.equal(manifest.NSPrivacyTracking, false);
  assert.deepEqual(manifest.NSPrivacyTrackingDomains, []);
  const api = manifest.NSPrivacyAccessedAPITypes.find((a) => a.NSPrivacyAccessedAPIType === "NSPrivacyAccessedAPICategoryUserDefaults");
  assert.deepEqual(api?.NSPrivacyAccessedAPITypeReasons, ["CA92.1"]);
  const types = manifest.NSPrivacyCollectedDataTypes.map((d) => d.NSPrivacyCollectedDataType.replace("NSPrivacyCollectedDataType", "")).sort();
  assert.deepEqual(types, ["AudioData", "CustomerSupport", "EmailAddress", "Health", "Name", "OtherDiagnosticData", "OtherUserContent", "PhysicalAddress", "PreciseLocation", "PurchaseHistory", "UserID"]);
  assert.ok(!types.includes("CoarseLocation"), "coordinates are stored precisely; do not declare Coarse");
  for (const d of manifest.NSPrivacyCollectedDataTypes) {
    assert.equal(d.NSPrivacyCollectedDataTypeTracking, false);
    assert.deepEqual(d.NSPrivacyCollectedDataTypePurposes, ["NSPrivacyCollectedDataTypePurposeAppFunctionality"]);
  }
});

test("privacy manifest is in the App target's Resources build phase", () => {
  const file = pbxproj.match(/(\w{24}) \/\* PrivacyInfo\.xcprivacy in Resources \*\/ = \{isa = PBXBuildFile/);
  assert.ok(file, "no PBXBuildFile for PrivacyInfo.xcprivacy");
  const phase = pbxproj.match(/isa = PBXResourcesBuildPhase;[\s\S]*?files = \(([\s\S]*?)\);/);
  assert.ok(phase, "no Resources build phase");
  assert.ok(phase[1].includes(file[1]), "PrivacyInfo.xcprivacy is not listed in the Resources build phase files");
});

test("entitlements: HealthKit only (IAP needs no entitlement file key)", () => {
  assert.deepEqual(Object.keys(entitlements).sort(), ["com.apple.developer.healthkit", "com.apple.developer.healthkit.access"]);
});
