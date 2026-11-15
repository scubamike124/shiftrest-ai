// Where the legacy /api/coach route forwards to /api/ai.
// Behind Railway's edge the server sees the request as plain http://<host>;
// fetching that public http URL gets a 301 to https, and fetch() then retries
// the POST as a GET, which returns the app's HTML page instead of the AI
// reply. Forward over loopback to this same Node server when its port is
// known, and never follow redirects. Nitro's node server listens on
// NITRO_PORT, else PORT. (In `vite dev` neither is the dev server's port, so
// leave PORT unset there.)
export function aiForwardUrl(
  requestUrl: string,
  env: { PORT?: string; NITRO_PORT?: string } = process.env,
): string {
  const raw = env.NITRO_PORT || env.PORT;
  const n = raw && /^\d{1,5}$/.test(raw) ? Number(raw) : 0;
  if (n >= 1 && n <= 65535) return `http://127.0.0.1:${n}/api/ai`;
  const url = new URL(requestUrl);
  url.pathname = "/api/ai";
  url.search = "";
  return url.toString();
}

// Response headers that must not be copied from the forwarded response:
// the body has already been decoded and re-streamed.
export const DROP_FORWARD_HEADERS = [
  "content-encoding",
  "content-length",
  "transfer-encoding",
  "connection",
];
