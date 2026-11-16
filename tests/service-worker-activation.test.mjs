import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

// Execute the production registrar and event wiring, including the async
// register() boundary; no parallel implementation of the reload decision.
const source = fs.readFileSync(new URL("../src/lib/pwa/register.ts", import.meta.url), "utf8");
const ast = ts.createSourceFile("register.ts", source, ts.ScriptTarget.Latest, true);
const functions = ast.statements.filter(
  (node) =>
    ts.isFunctionDeclaration(node) &&
    ["registerAppShell", "wireUpdateDetection"].includes(node.name?.text),
);
assert.equal(functions.length, 2);
const code = ts.transpileModule(functions.map((f) => f.getText(ast)).join("\n"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

async function registrar({ initial = null, duringRegistration, blockedStorage = false } = {}) {
  const listeners = new Map();
  const storage = new Map();
  let reloads = 0;
  const reg = { waiting: null, addEventListener() {}, async update() {} };
  const serviceWorker = {
    controller: initial,
    async register() {
      if (duringRegistration !== undefined) this.controller = duringRegistration;
      return reg;
    },
    addEventListener: (event, handler) => listeners.set(event, handler),
  };
  const sandbox = {
    exports: {},
    __BUILD_ID__: "same-build",
    SW_PATH: "/sw.js",
    navigator: { serviceWorker },
    window: { location: { reload: () => reloads++ } },
    document: { addEventListener() {} },
    sessionStorage: {
      getItem: (key) => {
        if (blockedStorage) throw new Error("Storage blocked");
        return storage.get(key) ?? null;
      },
      setItem: (key, value) => {
        if (blockedStorage) throw new Error("Storage blocked");
        storage.set(key, value);
      },
    },
    shouldRefuse: () => ({ refused: false }),
    announceIfWaiting() {},
    autoActivateIfPossible() {},
    emitUpdate() {},
    logBreadcrumb() {},
    installStaleBundleGuards() {},
    setTimeout() {},
    console: { info() {}, warn() {} },
  };
  vm.runInNewContext(code, sandbox);
  await sandbox.exports.registerAppShell();
  return {
    get reloads() {
      return reloads;
    },
    control(next) {
      serviceWorker.controller = next;
      listeners.get("controllerchange")();
    },
    message(build) {
      listeners.get("message")({ data: { type: "SW_ACTIVATED", build } });
    },
  };
}

test("first service-worker claim preserves the page; a later upgrade reloads once", async () => {
  const first = {},
    next = {};
  const app = await registrar();
  app.control(first);
  app.control(first);
  assert.equal(app.reloads, 0, "first installation must not discard unsaved UI state");
  app.control(next);
  app.control(next);
  assert.equal(app.reloads, 1);
});

test("claim during awaited registration is remembered without reloading", async () => {
  const first = {};
  const app = await registrar({ duringRegistration: first });
  app.control(first);
  assert.equal(app.reloads, 0);
  app.control({});
  assert.equal(app.reloads, 1, "a subsequent real update must still reload");
});

test("returning controlled page reloads for a new worker, not a duplicate event", async () => {
  const old = {};
  const app = await registrar({ initial: old });
  app.control(old);
  assert.equal(app.reloads, 0);
  app.control({});
  assert.equal(app.reloads, 1);
});

test("upgrade during awaited registration is reconciled and reloads once", async () => {
  const next = {};
  const app = await registrar({ initial: {}, duringRegistration: next });
  assert.equal(app.reloads, 1);
  app.control(next);
  assert.equal(app.reloads, 1);
});

test("blocked storage keeps first claim safe and duplicate upgrades bounded", async () => {
  const app = await registrar({ blockedStorage: true });
  app.control({});
  assert.equal(app.reloads, 0);
  app.control({});
  app.control({});
  assert.equal(app.reloads, 1);
});

test("same-build message preserves the page; cross-build fallback still reloads once", async () => {
  const app = await registrar();
  app.message("same-build");
  assert.equal(app.reloads, 0);
  app.message("new-build");
  app.message("new-build");
  assert.equal(app.reloads, 1);
});
