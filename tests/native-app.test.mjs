import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

const read = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const js = ts.transpileModule(read('src/lib/native-app.ts'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

function isNativeAppWith(windowValue) {
  const module = { exports: {} };
  const context = { module, exports: module.exports };
  if (windowValue !== undefined) context.window = windowValue;
  vm.runInNewContext(js, context);
  return module.exports.isNativeApp();
}

test('isNativeApp is true only inside the Capacitor app shell', () => {
  assert.equal(isNativeAppWith(undefined), false, 'server render');
  assert.equal(isNativeAppWith({}), false, 'browser');
  assert.equal(isNativeAppWith({ Capacitor: {} }), false, 'no isNativePlatform');
  assert.equal(isNativeAppWith({ Capacitor: { isNativePlatform: () => false } }), false, 'Capacitor web runtime');
  assert.equal(isNativeAppWith({ Capacitor: { isNativePlatform: () => true } }), true, 'iOS or Android shell');
  assert.equal(isNativeAppWith({ Capacitor: { isNativePlatform: () => { throw new Error('x'); } } }), false, 'never throws');
});

test('the app shell hides Google sign-in and Safari install instructions', () => {
  const auth = read('src/routes/auth.tsx');
  const gate = auth.indexOf('{inNativeApp ? (');
  const google = auth.indexOf('handleOAuth("google")');
  const form = auth.indexOf('<form onSubmit={handleEmailSubmit}');
  assert.ok(gate > 0 && gate < google && google < form, 'Google button sits inside the not-in-app block, before the email form');
  assert.match(read('src/components/SmartAlarmCoach.tsx'), /setHidden\(dismissed \|\| granted \|\| isNativeApp\(\)\)/);
  const card = read('src/components/SmartAlarmCard.tsx');
  assert.ok(card.indexOf('{inNativeApp ? (') > 0 && card.indexOf('{inNativeApp ? (') < card.indexOf('Home Screen installation'), 'alarm footer has an app-shell variant before the Home Screen copy');
  assert.match(auth, /Signed up with Google\? Enter your email and tap Forgot Password/);
  assert.match(read('src/lib/alarm/push-enroll.ts'), /!isStandalone\(\) && !isNativeApp\(\)\) showInstallHint\(\)/);
  const notif = read('src/components/NotificationsSection.tsx');
  assert.ok(notif.indexOf('!supported && isNativeApp()') < notif.indexOf('!supported && iosSafariNoStandalone'), 'app-shell message wins over Home Screen steps');
});
