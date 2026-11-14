// Pure builder for the new Supabase project's Auth settings (Management API
// PATCH /v1/projects/{ref}/config/auth). Unit-tested; no I/O.

export const SECRET_FIELDS = new Set([
  "external_google_secret",
  "external_apple_secret",
  "hook_send_email_secrets",
]);

export function normaliseOrigin(u) {
  const url = new URL(u);
  if (url.protocol !== "https:" && url.hostname !== "localhost")
    throw new Error(`${u}: https required`);
  return url.origin;
}

// siteUrl: the canonical app origin users land on (production domain once DNS
// moves; the staging origin before). appOrigins: every origin allowed as a
// redirect target (production apex + www + staging).
export function buildAuthPatch({
  siteUrl,
  appOrigins,
  hookBaseUrl,
  google,
  apple,
  sendEmailHookSecret,
}) {
  const site = normaliseOrigin(siteUrl);
  const origins = [...new Set([site, ...appOrigins.map(normaliseOrigin)])];
  const patch = {
    site_url: site,
    // The app sends users back to /auth, /auth/callback and /reset-password
    // with query strings; "/**" allows every path on each origin only.
    uri_allow_list: origins.map((o) => `${o}/**`).join(","),
    external_email_enabled: true,
    mailer_autoconfirm: false,
  };
  if (google?.clientId && google?.secret) {
    Object.assign(patch, {
      external_google_enabled: true,
      external_google_client_id: google.clientId,
      external_google_secret: google.secret,
    });
  }
  if (apple?.clientId && apple?.secret) {
    Object.assign(patch, {
      external_apple_enabled: true,
      external_apple_client_id: apple.clientId,
      external_apple_secret: apple.secret,
    });
  }
  if (sendEmailHookSecret) {
    if (!/^v1,whsec_[A-Za-z0-9+/=]{32,}$/.test(sendEmailHookSecret))
      throw new Error("send-email hook secret must look like v1,whsec_<base64>");
    Object.assign(patch, {
      hook_send_email_enabled: true,
      hook_send_email_uri: `${normaliseOrigin(hookBaseUrl || site)}/lovable/email/auth/webhook`,
      hook_send_email_secrets: sendEmailHookSecret,
    });
  }
  return patch;
}

// What would change, with secret values hidden.
export function describeChanges(current, patch) {
  return Object.entries(patch).map(([k, v]) => {
    const before = current?.[k];
    if (SECRET_FIELDS.has(k))
      return { field: k, change: before ? "replace (hidden)" : "set (hidden)" };
    return {
      field: k,
      before: before ?? null,
      after: v,
      change: JSON.stringify(before) === JSON.stringify(v) ? "unchanged" : "update",
    };
  });
}
