// Which links may open a page inside the app shell.
//
// Universal links (https://restpilotai.com/...) and notification taps carry a
// URL or path. Only our own hosts, and only same-site paths, are followed;
// anything else returns null and is ignored.

const OWN_HOSTS = new Set(["restpilotai.com", "www.restpilotai.com"]);

export function safeInAppPath(input: string, currentHost: string): string | null {
  if (typeof input !== "string" || !input) return null;
  // A bare path, e.g. "/plan" from a notification. Reject protocol-relative "//x".
  if (input.startsWith("/") && !input.startsWith("//") && !input.startsWith("/\\")) {
    return input.length <= 512 ? input : null;
  }
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  const host = url.host.toLowerCase();
  if (!OWN_HOSTS.has(host) && host !== currentHost.toLowerCase()) return null;
  const path = `${url.pathname}${url.search}${url.hash}`;
  return path.startsWith("/") && !path.startsWith("//") && path.length <= 512 ? path : null;
}
