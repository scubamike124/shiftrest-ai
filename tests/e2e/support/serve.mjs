#!/usr/bin/env node
// Starts the hermetic E2E stack used by playwright.config.ts:
//   fake Supabase + same-origin proxy  http://127.0.0.1:3000  (browser entry)
//   built app (npm run build output)   http://127.0.0.1:3001
//   fake OpenAI-compatible model       https://127.0.0.1:3443/v1
// Build first with the variables printed by `node tests/e2e/support/serve.mjs --print-build-env`.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ANON_KEY, SERVICE_ROLE_KEY, ensureCert, startFakeBackend } from "./fake-backend.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const FRONT = Number(process.env.E2E_PORT || 3000);
const APP = Number(process.env.E2E_APP_PORT || 3001);
const AI = Number(process.env.E2E_AI_PORT || 3443);
const front = `http://127.0.0.1:${FRONT}`;

export const buildEnv = {
  VITE_SUPABASE_URL: front,
  VITE_SUPABASE_PUBLISHABLE_KEY: ANON_KEY,
  VITE_SUPABASE_PROJECT_ID: "e2e-local",
};

if (process.argv.includes("--print-build-env")) {
  for (const [k, v] of Object.entries(buildEnv)) console.log(`${k}=${v}`);
  process.exit(0);
}

const entry = path.join(root, ".output/server/index.mjs");
if (!fs.existsSync(entry)) {
  console.error(
    "[e2e] .output is missing. Build with the E2E env first: see tests/e2e/README section in docs.",
  );
  process.exit(1);
}
const certDir = path.join(root, "tests/e2e/.results/certs");
const { cert } = ensureCert(certDir);

startFakeBackend({ port: FRONT, appUrl: `http://127.0.0.1:${APP}`, aiPort: AI, certDir });

const app = spawn(process.execPath, [entry], {
  cwd: root,
  stdio: ["ignore", "inherit", "inherit"],
  env: {
    ...process.env,
    PORT: String(APP),
    HOST: "127.0.0.1",
    NODE_ENV: "production",
    SUPABASE_URL: front,
    SUPABASE_PUBLISHABLE_KEY: ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_KEY,
    PUBLIC_APP_URL: front,
    AI_API_KEY: "e2e-fake-key",
    AI_BASE_URL: `https://127.0.0.1:${AI}/v1`,
    AI_CHAT_MODEL: "e2e-fake-model",
    AI_FAST_MODEL: "e2e-fake-model",
    NODE_EXTRA_CA_CERTS: cert,
    // Never reach real providers from an E2E run.
    RESEND_API_KEY: "",
    OPENAI_API_KEY: "",
    ELEVENLABS_API_KEY: "",
    STRIPE_SECRET_KEY: process.env.E2E_STRIPE_TEST_SECRET_KEY?.startsWith("sk_test_")
      ? process.env.E2E_STRIPE_TEST_SECRET_KEY
      : "",
  },
});
const stop = () => {
  app.kill("SIGTERM");
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
app.on("exit", (code) => {
  console.error(`[e2e] app server exited (${code})`);
  process.exit(code ?? 1);
});
console.log(`[e2e] stack up: ${front} (app :${APP}, model :${AI})`);
