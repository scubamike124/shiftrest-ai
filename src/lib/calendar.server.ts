// Slice 12 — Step 4. Server-only helpers for Calendar Intelligence.
// Fetches an ICS payload from a feed URL with a tight timeout and size cap.
// Never throws; returns null + an error string for clean caller handling.

const FETCH_TIMEOUT_MS = 8000;
const MAX_BYTES = 2 * 1024 * 1024; // 2 MB cap; larger feeds return an explicit error.

export interface IcsFetchResult {
  ok: boolean;
  body: string | null;
  error: string | null;
}

/** Only provider-controlled published-feed endpoints are fetched server-side.
 * Custom hosts need a separately reviewed egress proxy with network-level private
 * address denial. DNS prechecks cannot safely prevent rebinding in fetch().
 */
export function calendarFeedTarget(url: string): URL | null {
  if (typeof url !== "string" || url.length > 2000) return null;
  let parsed: URL;
  try {
    parsed = new URL(url.trim().replace(/^webcal:\/\//i, "https://"));
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password ||
      (parsed.port && parsed.port !== "443") || parsed.hash) return null;
  const host = parsed.hostname;
  const path = parsed.pathname;
  const google = host === "calendar.google.com" &&
    path.startsWith("/calendar/ical/") && path.endsWith(".ics");
  const microsoft = ["outlook.live.com", "outlook.office.com", "outlook.office365.com"].includes(host) &&
    path.startsWith("/owa/calendar/") && path.endsWith(".ics");
  const apple = /^p[0-9]{2,3}-caldav\.icloud\.com$/.test(host) &&
    path.startsWith("/published/");
  return google || microsoft || apple ? parsed : null;
}

export async function fetchIcsFeed(url: string): Promise<IcsFetchResult> {
  const parsed = calendarFeedTarget(url);
  if (!parsed) {
    return { ok: false, body: null, error: "Use a direct HTTPS published-calendar link from Google Calendar, Outlook, or iCloud. Other feed hosts are not supported yet." };
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(parsed.toString(), {
      signal: ctrl.signal,
      headers: {
        Accept: "text/calendar, text/plain;q=0.9, */*;q=0.5",
        "User-Agent": "RestPilotAI-Calendar/1.0",
      },
      redirect: "manual",
    });
    // Never follow even same-provider redirects: the destination might be an
    // internal host, or carry a sensitive feed token to another origin.
    if (res.status >= 300 && res.status < 400) {
      await res.body?.cancel();
      return { ok: false, body: null, error: "Calendar link redirects. Use the provider's direct published-calendar link." };
    }
    if (!res.ok) {
      await res.body?.cancel();
      return { ok: false, body: null, error: `HTTP ${res.status}` };
    }
    const reader = res.body?.getReader();
    if (!reader) {
      return { ok: false, body: null, error: "Calendar feed was empty" };
    }
    const chunks: Uint8Array[] = [];
    let received = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > MAX_BYTES) {
        await reader.cancel();
        return { ok: false, body: null, error: "Feed too large" };
      }
      chunks.push(value);
    }
    const body = new TextDecoder("utf-8").decode(concat(chunks));
    return { ok: true, body, error: null };
  } catch {
    // Fetch errors can contain the private subscription URL; never return or
    // persist those tokens in calendar_feeds.last_error.
    return { ok: false, body: null, error: ctrl.signal.aborted ? "Calendar request timed out" : "Calendar feed could not be loaded" };
  } finally {
    clearTimeout(timer);
  }
}

function concat(chunks: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const c of chunks) total += c.byteLength;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}
