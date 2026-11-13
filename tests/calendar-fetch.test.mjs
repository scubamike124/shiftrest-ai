import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = ts.transpileModule(readFileSync(new URL('../src/lib/calendar.server.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function load(fetch) {
  const module = { exports: {} };
  vm.runInNewContext(source, { exports: module.exports, module, URL, AbortController, setTimeout, clearTimeout, TextDecoder, fetch });
  return module.exports;
}
const allowed = [
  'https://calendar.google.com/calendar/ical/example%40example.com/private-token/basic.ics',
  'https://outlook.live.com/owa/calendar/token/calendar.ics',
  'https://outlook.office.com/owa/calendar/token/calendar.ics',
  'https://outlook.office365.com/owa/calendar/token/calendar.ics',
  'webcal://p01-caldav.icloud.com/published/2/token',
  'WEBCAL://p100-caldav.icloud.com/published/2/token',
];
const blocked = [
  'http://127.0.0.1/', 'https://127.0.0.1/', 'https://2130706433/', 'https://0x7f000001/',
  'https://[::1]/', 'https://[::ffff:127.0.0.1]/', 'http://169.254.169.254/latest/meta-data/',
  'https://10.0.0.1/', 'https://172.16.0.1/', 'https://192.168.1.1/', 'https://localhost/',
  'https://attacker.example/feed.ics', 'https://calendar.google.com.attacker.example/calendar/ical/x.ics',
  'https://calendar.google.com@attacker.example/calendar/ical/x.ics',
  'https://user:pass@calendar.google.com/calendar/ical/x.ics',
  'https://calendar.google.com:8443/calendar/ical/x.ics',
  'http://calendar.google.com/calendar/ical/x.ics',
  'https://calendar.google.com/calendar/ical/x.ics#secret',
  'https://calendar.google.com/url?url=http://127.0.0.1/',
  'https://calendar.google.com/calendar/ical/../../url?url=http://127.0.0.1/',
  'https://p01-caldav.icloud.com.attacker.example/published/2/token',
  'https://outlook.office365.com/owa/redirect?url=http://localhost',
  'file:///etc/passwd', 'data:text/calendar,BEGIN:VCALENDAR', 'not a url',
];
for (const target of blocked) test(`rejects untrusted target ${target}`, async () => {
  let calls = 0;
  const api = load(async () => { calls++; throw new Error('Should never fetch'); });
  assert.equal(api.calendarFeedTarget(target), null);
  assert.equal((await api.fetchIcsFeed(target)).ok, false);
  assert.equal(calls, 0);
});
for (const target of allowed) test(`accepts direct provider feed ${target}`, async () => {
  let calls = 0;
  const api = load(async (url, options) => {
    calls++;
    assert.equal(new URL(url).protocol, 'https:');
    assert.equal(options.redirect, 'manual');
    assert.equal(options.headers.Authorization, undefined);
    return new Response('BEGIN:VCALENDAR\nEND:VCALENDAR');
  });
  const result = await api.fetchIcsFeed(target);
  assert.equal(result.ok, true);
  assert.match(result.body, /BEGIN:VCALENDAR/);
  assert.equal(calls, 1);
});
test('provider redirect is not followed even when destination is private', async () => {
  let calls = 0;
  const api = load(async (_url, options) => {
    calls++;
    assert.equal(options.redirect, 'manual');
    return new Response(null, { status: 302, headers: { Location: 'http://169.254.169.254/latest/meta-data' } });
  });
  const result = await api.fetchIcsFeed(allowed[0]);
  assert.equal(result.ok, false);
  assert.match(result.error, /redirects/);
  assert.equal(calls, 1);
});
test('private subscription token is absent from fetch failure text', async () => {
  const api = load(async () => { throw new Error('Network error private-token'); });
  const result = await api.fetchIcsFeed(allowed[0]);
  assert.equal(result.ok, false);
  assert.doesNotMatch(result.error, /private-token/);
});
test('oversized stream is cancelled before it grows past feed limit', async () => {
  let cancelled = false;
  const api = load(async () => new Response(new ReadableStream({
    pull(controller) { controller.enqueue(new Uint8Array(1024 * 1024)); },
    cancel() { cancelled = true; },
  })));
  const result = await api.fetchIcsFeed(allowed[0]);
  assert.equal(result.error, 'Feed too large');
  assert.equal(cancelled, true);
});
