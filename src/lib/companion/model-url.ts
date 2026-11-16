// Which 3D head model (if any) the Companion may load.
//
// There is no default 3D model. The Ready Player Me head the app used to load
// came from models.readyplayer.me, which no longer resolves (NXDOMAIN, Nov 2026),
// and the bundled GLB on the Lovable asset CDN is gltfpack-compressed and does
// not decode on iOS Safari. Every surface therefore shows the 2D portrait.
//
// An internal QA override (`companion.modelUrl` in localStorage) is still honoured,
// except when it points at the dead Ready Player Me host: a stale override saved
// by the old Settings field must never make the app request it.

const DEAD_MODEL_HOSTS = /(^|\.)readyplayer\.me$/i;

export function resolveModelUrl(custom: string | null | undefined): string | null {
  const raw = custom?.trim();
  if (!raw) return null;
  // A same-origin path (for example the bundled asset) is fine as is.
  if (raw.startsWith("/") && !raw.startsWith("//")) return raw;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (DEAD_MODEL_HOSTS.test(url.hostname)) return null;
  return url.toString();
}
