// Appearance themes: preference logic, the pre-paint boot script, and WCAG AA
// contrast of each theme's colour tokens (read from src/styles.css).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import {
  THEMES,
  DEFAULT_APPEARANCE,
  parseAppearance,
  resolveTheme,
  isThemedPath,
  themeBootScript,
  userAppearanceKey,
  APPEARANCE_KEY,
} from "../src/lib/appearance.ts";

test("five themes, Midnight Purple is the default, ids are unique", () => {
  assert.deepEqual(
    THEMES.map((t) => t.name),
    ["Midnight Purple", "Ocean Blue", "Forest Green", "Warm Sunset", "Soft Light"],
  );
  assert.equal(new Set(THEMES.map((t) => t.id)).size, 5);
  assert.deepEqual(DEFAULT_APPEARANCE, { theme: "midnight", matchSystem: false });
});

test("stored values are validated; anything malformed falls back to the default", () => {
  assert.deepEqual(parseAppearance(null), DEFAULT_APPEARANCE);
  assert.deepEqual(parseAppearance("not json"), DEFAULT_APPEARANCE);
  assert.deepEqual(parseAppearance('{"theme":"neon","matchSystem":"yes"}'), DEFAULT_APPEARANCE);
  assert.deepEqual(parseAppearance('{"theme":"ocean","matchSystem":true}'), {
    theme: "ocean",
    matchSystem: true,
  });
  // A value that tries to smuggle CSS or markup is rejected, not applied.
  assert.equal(parseAppearance('{"theme":"\\"><script>"}').theme, "midnight");
});

test("Match iPhone appearance: Soft Light by day, the chosen dark theme by night", () => {
  assert.equal(resolveTheme({ theme: "forest", matchSystem: true }, true), "light");
  assert.equal(resolveTheme({ theme: "forest", matchSystem: true }, false), "forest");
  assert.equal(resolveTheme({ theme: "light", matchSystem: true }, false), "midnight");
  assert.equal(resolveTheme({ theme: "sunset", matchSystem: false }, true), "sunset");
  assert.equal(resolveTheme({ theme: "light", matchSystem: false }, false), "light");
});

test("marketing pages keep the brand theme; app pages follow the preference", () => {
  for (const p of ["/", "/pricing", "/features", "/legal", "/legal/privacy"])
    assert.equal(isThemedPath(p), false, p);
  for (const p of ["/dashboard", "/plan", "/companion", "/profile", "/auth", "/settings"])
    assert.equal(isThemedPath(p), true, p);
});

test("per-user storage key", () => {
  assert.equal(userAppearanceKey(null), null);
  assert.equal(userAppearanceKey("u1"), `${APPEARANCE_KEY}:u1`);
});

function runBoot({ stored, path, prefersLight }) {
  const attrs = {};
  const style = {};
  let metaContent = "#0b1020";
  const ctx = {
    localStorage: { getItem: (k) => (k === APPEARANCE_KEY ? stored : null) },
    location: { pathname: path },
    window: { matchMedia: () => ({ matches: prefersLight }) },
    matchMedia: () => ({ matches: prefersLight }),
    document: {
      documentElement: { setAttribute: (k, v) => (attrs[k] = v), style },
      querySelector: () => ({ setAttribute: (_k, v) => (metaContent = v) }),
    },
  };
  vm.runInNewContext(themeBootScript(), ctx);
  return { theme: attrs["data-theme"] ?? "midnight", scheme: style.colorScheme, meta: metaContent };
}

test("pre-paint boot script agrees with resolveTheme", () => {
  const cases = [
    [null, "/dashboard", false],
    ['{"theme":"ocean"}', "/plan", false],
    ['{"theme":"light"}', "/dashboard", false],
    ['{"theme":"forest","matchSystem":true}', "/dashboard", true],
    ['{"theme":"forest","matchSystem":true}', "/dashboard", false],
    ['{"theme":"light","matchSystem":true}', "/profile", false],
    ['{"theme":"sunset"}', "/", false],
    ['{"theme":"light"}', "/legal/terms", true],
    ["garbage", "/dashboard", true],
  ];
  for (const [stored, path, prefersLight] of cases) {
    const expected = isThemedPath(path)
      ? resolveTheme(parseAppearance(stored), prefersLight)
      : "midnight";
    const got = runBoot({ stored, path, prefersLight });
    assert.equal(got.theme, expected, `${stored} ${path} ${prefersLight}`);
    assert.equal(got.scheme, expected === "light" ? "light" : "dark", `scheme ${stored} ${path}`);
    assert.equal(got.meta, THEMES.find((t) => t.id === expected).chrome);
  }
});

// ---- WCAG contrast from the real CSS tokens ----

const css = fs.readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

function block(selector) {
  const i = css.indexOf(selector + " {");
  assert.ok(i >= 0, `missing ${selector}`);
  const body = css.slice(i, css.indexOf("\n}", i));
  const vars = {};
  for (const m of body.matchAll(/--([\w-]+):\s*(oklch\([^)]*\))\s*;/g)) vars[m[1]] = m[2];
  return vars;
}

const midnight = block(":root");
const themes = {
  midnight,
  ocean: { ...midnight, ...block(':root[data-theme="ocean"]') },
  forest: { ...midnight, ...block(':root[data-theme="forest"]') },
  sunset: { ...midnight, ...block(':root[data-theme="sunset"]') },
  light: { ...midnight, ...block(':root[data-theme="light"]') },
};

function oklchToLuminance(str) {
  const m = str.match(/oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)/);
  assert.ok(m, `unparsable ${str}`);
  const [L, C, H] = [Number(m[1]), Number(m[2]), (Number(m[3]) * Math.PI) / 180];
  const a = C * Math.cos(H);
  const b = C * Math.sin(H);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mm = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const clamp = (x) => Math.min(1, Math.max(0, x));
  const r = clamp(4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s);
  const g = clamp(-1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s);
  const bl = clamp(-0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * s);
  return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
}

function contrast(a, b) {
  const [x, y] = [oklchToLuminance(a), oklchToLuminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

// Text pairs that must meet WCAG AA for normal text (4.5:1).
const TEXT_PAIRS = [
  ["foreground", "background"],
  ["foreground", "card"],
  ["card-foreground", "card"],
  ["muted-foreground", "background"],
  ["muted-foreground", "card"],
  ["primary-foreground", "primary"],
  ["secondary-foreground", "secondary"],
  ["indigo-glow", "background"],
  ["indigo-glow", "card"],
  ["popover-foreground", "popover"],
];

for (const [name, t] of Object.entries(themes)) {
  test(`${name}: text tokens meet WCAG AA (4.5:1)`, () => {
    for (const [fg, bg] of TEXT_PAIRS) {
      const c = contrast(t[fg], t[bg]);
      assert.ok(c >= 4.5, `${name} ${fg} on ${bg} = ${c.toFixed(2)}:1`);
    }
  });
  test(`${name}: primary buttons and focus rings are distinguishable (3:1 non-text)`, () => {
    assert.ok(
      contrast(t.ring, t.background) >= 3,
      `${name} ring ${contrast(t.ring, t.background).toFixed(2)}`,
    );
  });
}
