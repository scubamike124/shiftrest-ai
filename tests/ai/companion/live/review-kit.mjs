#!/usr/bin/env node
/**
 * Blind-review kit for the AI quality review (docs/restpilot-upgrade-2026-11/AI-QUALITY-RUBRIC.md).
 *
 *   node review-kit.mjs packets --source LABEL=responses.jsonl [--source ...] --out DIR [--seed N]
 *     Builds anonymised review items: model, provider and prompt version are
 *     stripped, items are shuffled and get random ids. The id -> source mapping
 *     goes to DIR/private/mapping.json, which reviewers never receive.
 *     Also runs the deterministic checks (live/checks.cjs) into DIR/private/checks.json.
 *
 *   node review-kit.mjs aggregate --out DIR --scores r1.jsonl,r2.jsonl,r3.jsonl [--tiebreak r4.jsonl]
 *     Median per item and category, >20-point disagreements (for a fourth
 *     reviewer), critical flags (2 of 3, or the tie-breaker), per-category and
 *     per-source statistics. Writes DIR/private/aggregate.json.
 *
 * Responses file format: one JSON object per scenario,
 *   { id, prefs?, turns: [{ turn, user, reply, sendLocal, finish?, ttftMs?, totalMs?, intercepted? }] }
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const scenarios = Object.fromEntries(require("./scenarios.cjs").map((s) => [s.id, s]));
const { check } = require("./checks.cjs");

const [cmd, ...rest] = process.argv.slice(2);
const many = (n) => rest.flatMap((a, i) => (rest[i - 1] === n ? [a] : []));
const opt = (n, d) => many(n)[0] ?? d;
const OUT = opt("--out");
if (!OUT) throw new Error("--out is required");
const PRIV = path.join(OUT, "private");
fs.mkdirSync(PRIV, { recursive: true });
const readJsonl = (f) => fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const CATS = ["professionalism", "usefulness", "accuracy", "empathy", "safety", "consistency"];

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

function localClock(iso, tz) {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long", hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(iso));
}

if (cmd === "packets") {
  if (fs.existsSync(path.join(PRIV, "mapping.json")) && !rest.includes("--force"))
    throw new Error("packets already built here (rids are random; rebuilding would orphan reviews). Use --force.");
  const rand = rng(Number(opt("--seed", String(Date.now() % 1e9))));
  const tz = opt("--tz", "America/New_York");
  const items = [];
  const mapping = {};
  const checks = {};
  const product = [];
  for (const spec of many("--source")) {
    const [label, file] = spec.split("=");
    for (const rec of readJsonl(file)) {
      const s = scenarios[rec.id];
      if (!s) throw new Error(`unknown scenario ${rec.id}`);
      const goal = rec.prefs?.sleep_hours ?? 7.5;
      const history = [];
      for (const t of rec.turns) {
        if (t.intercepted) {
          product.push({ source: label, id: rec.id, turn: t.turn, user: t.user, ui: (t.ui || "").slice(-600) });
          continue;
        }
        const rid = crypto.randomBytes(4).toString("hex");
        const reply = (t.reply || "").trim();
        items.push({
          rid,
          scenario: {
            surface: "RestPilot Companion page (spoken surface: replies are read aloud; the app asks for 1 to 3 short sentences, no markdown, no greeting)",
            userRole: s.persona,
            category: s.cat,
            safetyCritical: s.critical,
            localSendTime: localClock(t.sendLocal, tz) + ` (${tz})`,
            appKnows: `No wearable connected. No shifts saved. Sleep goal in settings: ${goal} h. Everything else comes from the user's own words.`,
            conversationSoFar: [...history],
            userMessage: t.user,
            isFollowUpTurn: t.turn > 0,
          },
          expectedBehaviour: s.expect,
          references: [s.reference, ...(s.sources || [])].filter(Boolean),
          reply: reply || "(empty reply: the user saw nothing)",
        });
        mapping[rid] = { source: label, id: rec.id, turn: t.turn, ttftMs: t.ttftMs ?? null, totalMs: t.totalMs ?? null, finish: t.finish ?? null, persona: s.persona, cat: s.cat, scenarioCritical: s.critical };
        checks[rid] = check(s, t.turn, reply, { sleepGoalHours: goal, surface: "voice", finish: t.finish });
        history.push({ role: "user", content: t.user }, { role: "assistant", content: reply });
      }
    }
  }
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  fs.writeFileSync(path.join(OUT, "items.json"), JSON.stringify(items, null, 1));
  fs.writeFileSync(path.join(PRIV, "mapping.json"), JSON.stringify(mapping, null, 1));
  fs.writeFileSync(path.join(PRIV, "checks.json"), JSON.stringify(checks, null, 1));
  fs.writeFileSync(path.join(PRIV, "intercepted.json"), JSON.stringify(product, null, 1));
  console.log(`${items.length} items, ${product.length} intercepted turns`);
} else if (cmd === "aggregate") {
  const mapping = JSON.parse(fs.readFileSync(path.join(PRIV, "mapping.json"), "utf8"));
  const checks = JSON.parse(fs.readFileSync(path.join(PRIV, "checks.json"), "utf8"));
  const reviewers = opt("--scores").split(",").map((f) => Object.fromEntries(readJsonl(f).map((x) => [x.rid, x])));
  const tiebreak = opt("--tiebreak") ? Object.fromEntries(readJsonl(opt("--tiebreak")).map((x) => [x.rid, x])) : {};
  const median = (xs) => {
    const v = xs.filter((x) => typeof x === "number").sort((a, b) => a - b);
    if (!v.length) return null;
    const m = Math.floor(v.length / 2);
    return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
  };
  const out = [];
  const disagreements = [];
  for (const rid of Object.keys(mapping)) {
    const rs = reviewers.map((r) => r[rid]).filter(Boolean);
    if (rs.length < reviewers.length) console.warn(`item ${rid}: only ${rs.length} reviews`);
    const tb = tiebreak[rid];
    const scores = {};
    let split = false;
    for (const c of CATS) {
      const vals = rs.map((r) => r[c]).filter((x) => typeof x === "number");
      if (vals.length && Math.max(...vals) - Math.min(...vals) > 20) split = true;
      const all = tb && typeof tb[c] === "number" ? [...vals, tb[c]] : vals;
      scores[c] = mapping[rid].turn > 0 || c !== "consistency" ? median(all) : null;
    }
    if (split) disagreements.push(rid);
    const flags = rs.filter((r) => r.critical && r.critical !== "false").length;
    const critical = flags >= 2 || (flags === 1 && tb && tb.critical && tb.critical !== "false");
    const applicable = CATS.filter((c) => typeof scores[c] === "number");
    const item = applicable.reduce((a, c) => a + scores[c], 0) / applicable.length;
    out.push({
      rid, ...mapping[rid], scores, item: Math.round(item * 10) / 10, critical, criticalFlags: flags,
      criticalSections: [...rs, tb].filter((r) => r && r.critical && r.critical !== "false").map((r) => r.critical),
      split, why: [...rs.map((r) => r.why), tb ? `[tie-break] ${tb.why}` : null].filter(Boolean),
      failedChecks: (checks[rid] || []).filter((c) => !c.pass).map((c) => `${c.name}: ${c.reason}`),
    });
  }
  fs.writeFileSync(path.join(PRIV, "aggregate.json"), JSON.stringify({ items: out, disagreements }, null, 1));
  console.log(`${out.length} items aggregated; ${disagreements.length} need a fourth reviewer: ${disagreements.join(",")}`);
} else {
  console.error("usage: review-kit.mjs packets|aggregate ...");
  process.exit(1);
}
