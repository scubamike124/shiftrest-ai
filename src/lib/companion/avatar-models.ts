// Ready Player Me model URLs for each preset. Append the morphTargets query
// so the GLB exposes ARKit + Oculus visemes for lip-sync.
//
// Missing/404 URLs fall back to the 2D portrait renderer.

const RPM_QUERY = "morphTargets=ARKit,Oculus%20Visemes&textureAtlas=1024&pose=A&lod=1";

function rpm(id: string): string {
  return `https://models.readyplayer.me/${id}.glb?${RPM_QUERY}`;
}

// Demo RPM avatars (publicly accessible, head-and-shoulders friendly).
// These IDs come from RPM's public template gallery; if any 404, the 2D
// portrait is shown automatically.
export const AVATAR_MODEL_URLS: Record<string, string> = {
  aura:  rpm("64bfa15f0e72c63d7c3934a6"),
  nova:  rpm("65a8dba831b23abb4f401bae"),
  atlas: rpm("64bfa1c40e72c63d7c39351b"),
  sage:  rpm("64bfa20c0e72c63d7c393525"),
};

export function modelUrlFor(id: string | null | undefined): string | null {
  if (!id) return null;
  if (id.startsWith("custom:")) return null;
  return AVATAR_MODEL_URLS[id] ?? null;
}
