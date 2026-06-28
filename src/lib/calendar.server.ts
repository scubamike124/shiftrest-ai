// Slice 12 — Step 4. Server-only helpers for Calendar Intelligence.
// Fetches an ICS payload from a feed URL with a tight timeout and size cap.
// Never throws; returns null + an error string for clean caller handling.

const FETCH_TIMEOUT_MS = 8000;
const MAX_BYTES = 2 * 1024 * 1024; // 2 MB cap — every consumer feed fits.

export interface IcsFetchResult {
  ok: boolean;
  body: string | null;
  error: string | null;
}

function normalizeWebcal(url: string): string {
  if (url.startsWith("webcal://")) return "https://" + url.slice("webcal://".length);
  return url;
}

export async function fetchIcsFeed(url: string): Promise<IcsFetchResult> {
  const target = normalizeWebcal(url.trim());
  // Guard against obviously bad inputs without spending a network call.
  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return { ok: false, body: null, error: "Invalid URL" };
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { ok: false, body: null, error: "URL must be http(s) or webcal" };
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
      redirect: "follow",
    });
    if (!res.ok) {
      return { ok: false, body: null, error: `HTTP ${res.status}` };
    }
    const reader = res.body?.getReader();
    if (!reader) {
      const text = await res.text();
      return text.length > MAX_BYTES
        ? { ok: false, body: null, error: "Feed too large" }
        : { ok: true, body: text, error: null };
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
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Fetch failed";
    return { ok: false, body: null, error: msg };
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
