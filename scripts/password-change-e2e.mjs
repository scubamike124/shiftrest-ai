/**
 * Verify password change via GoTrue updateUser while authenticated.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = fs.readFileSync(path.join(root, ".env"), "utf8");
const strip = (s) => (s || "").trim().replace(/^["']|["']$/g, "");
const grab = (name) => strip((env.match(new RegExp(`^${name}=(.+)$`, "m")) || [])[1]);
const url = grab("VITE_SUPABASE_URL") || grab("SUPABASE_URL");
const key = grab("VITE_SUPABASE_PUBLISHABLE_KEY") || grab("SUPABASE_PUBLISHABLE_KEY");
const sessionPath = path.join(root, ".e2e-session.json");
const session = JSON.parse(fs.readFileSync(sessionPath, "utf8"));

async function passwordGrant(email, password) {
  const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password }),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

const oldPassword = session.password;
const newPassword = `E2eChg!${Date.now().toString().slice(-6)}Aa1`;

const login = await passwordGrant(session.email, oldPassword);
if (!login.json.access_token) {
  console.log(JSON.stringify({ ok: false, step: "login_old", status: login.status }));
  process.exit(2);
}

const upd = await fetch(`${url}/auth/v1/user`, {
  method: "PUT",
  headers: {
    apikey: key,
    Authorization: `Bearer ${login.json.access_token}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ password: newPassword }),
});
const updJson = await upd.json().catch(() => ({}));
if (upd.status >= 300) {
  console.log(
    JSON.stringify({
      ok: false,
      step: "update_password",
      status: upd.status,
      msg: updJson.msg || updJson.message,
    }),
  );
  process.exit(3);
}

const reloginNew = await passwordGrant(session.email, newPassword);
const reloginOld = await passwordGrant(session.email, oldPassword);

const ok = Boolean(reloginNew.json.access_token) && !reloginOld.json.access_token;
if (ok) {
  session.password = newPassword;
  session.access_token = reloginNew.json.access_token;
  session.refresh_token = reloginNew.json.refresh_token;
  session.passwordChangedAt = new Date().toISOString();
  fs.writeFileSync(sessionPath, JSON.stringify(session, null, 2));
}

console.log(
  JSON.stringify({
    ok,
    updateStatus: upd.status,
    newLogin: reloginNew.status,
    oldLoginRejected: reloginOld.status !== 200,
  }),
);
process.exit(ok ? 0 : 4);
