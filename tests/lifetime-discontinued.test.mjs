import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

// Owner decision (Nov 14 2026): the $99 lifetime membership is permanently
// discontinued for NEW customers. Existing lifetime entitlements stay valid.
const root = new URL('..', import.meta.url).pathname;
const read = (p) => readFileSync(join(root, p), 'utf8');

function walk(dir, out = []) {
  for (const name of readdirSync(join(root, dir))) {
    const rel = join(dir, name);
    if (statSync(join(root, rel)).isDirectory()) walk(rel, out);
    else if (/\.(tsx?|html)$/.test(name) && !name.endsWith('.gen.ts')) out.push(rel);
  }
  return out;
}

test('no customer-facing screen offers a $99 or lifetime purchase', () => {
  const offenders = [];
  for (const file of [...walk('src/routes'), ...walk('src/components')]) {
    const text = read(file);
    if (/\$\s?99\b|USD 99\b|Choose Lifetime|plan[=:]\s*["']?lifetime|Pay once, use forever/i.test(text)) offenders.push(file);
  }
  assert.deepEqual(offenders, []);
});

test('paywall search params no longer accept a lifetime plan', () => {
  const paywall = read('src/routes/paywall.tsx');
  assert.doesNotMatch(paywall, /search\.plan === "lifetime"/);
});

test('existing lifetime entitlements are still honored', () => {
  assert.match(read('src/lib/subscription.ts'), /restpilot_lifetime: "lifetime"/);
  assert.match(read('src/lib/subscription.ts'), /data\.status === "lifetime"/);
  assert.match(read('src/lib/realtime/access.server.ts'), /r\.status === 'lifetime'/);
  const webhook = read('src/routes/api/public/payments/webhook.ts');
  assert.match(webhook, /priceId !== "restpilot_lifetime"/);
  assert.match(webhook, /status: "lifetime"/);
});
