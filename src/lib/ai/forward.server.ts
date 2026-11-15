// Where the legacy /api/coach route forwards to /api/ai.
// Behind Railway's edge the server sees the request as plain http://<host>;
// fetching that public http URL gets a 301 to https, and fetch() then retries
// the POST as a GET, which returns the app's HTML page instead of the AI
// reply. Forward over loopback to this same Node server when its port is
// known, and never follow redirects.
export function aiForwardUrl(requestUrl: string, env: { PORT?: string } = process.env): string {
  const port = env.PORT && /^\d{1,5}$/.test(env.PORT) ? env.PORT : null;
  if (port) return `http://127.0.0.1:${port}/api/ai`;
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
