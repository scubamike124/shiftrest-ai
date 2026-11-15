#!/usr/bin/env node
// Configure the NEW Supabase project's Auth and hand its connection values to
// Railway, without printing any secret.
//
//   SUPABASE_ACCESS_TOKEN=... SUPABASE_PROJECT_REF=<new ref> \
//   SITE_URL=https://restpilot-web-staging.up.railway.app \
//   APP_ORIGINS=https://restpilotai.com,https://www.restpilotai.com,https://restpilot-web-staging.up.railway.app \
//   [GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=...] [SEND_EMAIL_HOOK_SECRET=v1,whsec_... | --generate-hook-secret] \
//     node scripts/migration/configure-auth.mjs [--apply] [--sync-railway]
//       [--generate-hook-secret] [--generate-cron-secret]
//
// Default is a dry run: it reads the current settings and prints the planned
// changes (secret fields shown as hidden) and the Railway variable names it
// would write. Nothing is written without --apply.
// --apply PATCHes the Auth config; with --sync-railway it also writes the
// project's URL/ref/publishable key/service-role key (and generated secrets)
// to the Railway service named by RAILWAY_PROJECT_ID / RAILWAY_ENVIRONMENT_ID /
// RAILWAY_SERVICE_ID using RAILWAY_TOKEN, printing variable NAMES only.
// Railway then redeploys that service.
// --generate-hook-secret: a new Send Email Hook secret, written to both sides
//   (requires --sync-railway). Re-running rotates it on both sides.
// --generate-cron-secret: a CRON_SECRET for the web service, created only if
//   the service has none (rewire.mjs stores the same value in Vault by
//   referencing that variable), so re-runs never desynchronise it.
import { randomBytes } from "node:crypto";
import { buildAuthPatch, describeChanges } from "./auth-config.mjs";
import { LIVE_SOURCE_REF } from "./lib.mjs";

const flags = new Set(process.argv.slice(2));
const env = process.env;
const ref = env.SUPABASE_PROJECT_REF;
if (!ref || !/^[a-z0-9]{20}$/.test(ref)) {
  console.error("SUPABASE_PROJECT_REF (20 lowercase letters/digits) is required");
  process.exit(2);
}
if (ref === LIVE_SOURCE_REF) {
  console.error("refusing: that is the live Lovable Cloud project");
  process.exit(2);
}
if (!env.SUPABASE_ACCESS_TOKEN) {
  console.error("SUPABASE_ACCESS_TOKEN is required (value is never printed)");
  process.exit(2);
}

const api = async (method, path, body) => {
  const r = await fetch(`https://api.supabase.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  if (!r.ok)
    throw new Error(
      `${method} ${path.replace(ref, "<ref>")}: HTTP ${r.status} ${text.slice(0, 300)}`,
    );
  return text ? JSON.parse(text) : null;
};

const apply = flags.has("--apply");
const sync = flags.has("--sync-railway");
if ((flags.has("--generate-hook-secret") || flags.has("--generate-cron-secret")) && !sync) {
  console.error("--generate-* needs --sync-railway, or the generated value would be lost");
  process.exit(2);
}
let hookSecret = env.SEND_EMAIL_HOOK_SECRET;
if (!hookSecret && flags.has("--generate-hook-secret"))
  hookSecret = `v1,whsec_${randomBytes(32).toString("base64")}`;

const patch = buildAuthPatch({
  siteUrl: env.SITE_URL,
  appOrigins: (env.APP_ORIGINS || "").split(",").filter(Boolean),
  hookBaseUrl: env.HOOK_BASE_URL,
  google: { clientId: env.GOOGLE_CLIENT_ID, secret: env.GOOGLE_CLIENT_SECRET },
  apple: { clientId: env.APPLE_CLIENT_ID, secret: env.APPLE_CLIENT_SECRET },
  sendEmailHookSecret: hookSecret,
});
const current = await api("GET", `/v1/projects/${ref}/config/auth`);
console.log(`${apply ? "APPLY" : "DRY RUN"}: Auth settings for project ${ref}`);
for (const c of describeChanges(current, patch)) {
  console.log(
    `- ${c.field}: ${c.change}${"after" in c && c.change !== "unchanged" ? ` ${JSON.stringify(c.before)} -> ${JSON.stringify(c.after)}` : ""}`,
  );
}
if (!patch.external_google_enabled)
  console.log(
    "- Google sign-in: not configured (GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET not provided)",
  );
if (!patch.hook_send_email_enabled)
  console.log(
    "- Send Email Hook: not configured; Supabase's built-in mailer only reaches project team members (2/hour)",
  );
const railway = async (query, variables) => {
  const r = await fetch("https://backboard.railway.app/graphql/v2", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RAILWAY_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const body = await r.json();
  if (!r.ok || body.errors)
    throw new Error(`Railway API: ${JSON.stringify(body.errors || r.status).slice(0, 300)}`);
  return body.data;
};

if (sync) {
  for (const k of [
    "RAILWAY_TOKEN",
    "RAILWAY_PROJECT_ID",
    "RAILWAY_ENVIRONMENT_ID",
    "RAILWAY_SERVICE_ID",
  ]) {
    if (!env[k]) {
      console.error(`${k} is required for --sync-railway`);
      process.exit(2);
    }
  }
  const ids = {
    projectId: env.RAILWAY_PROJECT_ID,
    environmentId: env.RAILWAY_ENVIRONMENT_ID,
    serviceId: env.RAILWAY_SERVICE_ID,
  };
  const existing = await railway(
    "query($projectId: String!, $environmentId: String!, $serviceId: String!) { variables(projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId) }",
    ids,
  );
  const hasCron = Boolean(existing.variables.CRON_SECRET);
  const keys = await api("GET", `/v1/projects/${ref}/api-keys?reveal=true`);
  const pick = (pred) => keys.find(pred)?.api_key;
  // Prefer the legacy JWT keys the app was built against (same shape as
  // Lovable's); fall back to the new publishable/secret keys.
  const publishable = pick((k) => k.name === "anon") || pick((k) => k.type === "publishable");
  const service = pick((k) => k.name === "service_role") || pick((k) => k.type === "secret");
  if (!publishable || !service) {
    console.error("could not read the project's API keys");
    process.exit(1);
  }
  const supabaseUrl = `https://${ref}.supabase.co`;
  const variables = {
    SUPABASE_URL: supabaseUrl,
    VITE_SUPABASE_URL: supabaseUrl,
    SUPABASE_PROJECT_ID: ref,
    VITE_SUPABASE_PROJECT_ID: ref,
    SUPABASE_PUBLISHABLE_KEY: publishable,
    VITE_SUPABASE_PUBLISHABLE_KEY: publishable,
    SUPABASE_SERVICE_ROLE_KEY: service,
    ...(hookSecret ? { SEND_EMAIL_HOOK_SECRET: hookSecret } : {}),
    ...(flags.has("--generate-cron-secret") && !hasCron
      ? { CRON_SECRET: randomBytes(32).toString("base64url") }
      : {}),
  };
  if (flags.has("--generate-cron-secret") && hasCron)
    console.log("- CRON_SECRET already set on the service; kept unchanged");
  if (!apply) {
    console.log(
      `DRY RUN: would set Railway variables (names only): ${Object.keys(variables).join(", ")}`,
    );
  } else {
    await railway(
      "mutation($i: VariableCollectionUpsertInput!) { variableCollectionUpsert(input: $i) }",
      {
        i: { ...ids, variables },
      },
    );
    console.log(`Railway variables set (names only): ${Object.keys(variables).join(", ")}`);
  }
}

// Auth config last: if the Railway write failed, Supabase still has the
// previous hook secret, matching what the app holds.
if (apply) {
  await api("PATCH", `/v1/projects/${ref}/config/auth`, patch);
  console.log("Auth settings updated.");
}
