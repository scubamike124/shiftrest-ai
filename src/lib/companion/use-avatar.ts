// useAvatar — reads the active companion avatar id from localStorage
// (SSR-safe synchronous read), hydrates from Supabase profile on mount,
// and updates when other tabs change the selection.

import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  AVATAR_PRESETS,
  DEFAULT_AVATAR_ID,
  resolveAvatarSrc,
} from "./avatars";

const KEY = "companion_avatar_id";

function readLocal(): string {
  if (typeof window === "undefined") return DEFAULT_AVATAR_ID;
  try {
    return window.localStorage.getItem(KEY) || DEFAULT_AVATAR_ID;
  } catch {
    return DEFAULT_AVATAR_ID;
  }
}

function writeLocal(id: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, id);
    window.dispatchEvent(new CustomEvent("companion:avatar-changed", { detail: { id } }));
  } catch { /* ignore */ }
}

export function useAvatar() {
  const [id, setId] = useState<string>(() => readLocal());

  useEffect(() => {
    let alive = true;
    // Hydrate from profile (best-effort)
    (async () => {
      try {
        const { data: sess } = await supabase.auth.getSession();
        const uid = sess.session?.user?.id;
        if (!uid) return;
        const { data } = await supabase
          .from("profiles")
          .select("companion_avatar_id")
          .eq("id", uid)
          .maybeSingle();
        const remote = (data as { companion_avatar_id?: string | null } | null)?.companion_avatar_id;
        if (alive && remote && remote !== id) {
          writeLocal(remote);
          setId(remote);
        }
      } catch { /* offline / unauth — local is source of truth */ }
    })();

    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY && e.newValue) setId(e.newValue);
    };
    const onCustom = (e: Event) => {
      const d = (e as CustomEvent<{ id: string }>).detail;
      if (d?.id) setId(d.id);
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("companion:avatar-changed", onCustom as EventListener);
    return () => {
      alive = false;
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("companion:avatar-changed", onCustom as EventListener);
    };
  }, [id]);

  const setAvatar = useCallback(async (newId: string) => {
    writeLocal(newId);
    setId(newId);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const uid = sess.session?.user?.id;
      if (uid) {
        await supabase.from("profiles").update({ companion_avatar_id: newId }).eq("id", uid);
      }
    } catch { /* best-effort cross-device sync */ }
  }, []);

  return {
    id,
    src: resolveAvatarSrc(id),
    setAvatar,
    presets: AVATAR_PRESETS,
  };
}
