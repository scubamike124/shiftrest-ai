// Applies the user's Appearance choice to <html>, follows the phone's
// Light/Dark setting when "Match iPhone appearance" is on, and keeps marketing
// pages on the brand's Midnight theme. Renders nothing.
import { useEffect, useState } from "react";
import {
  APPEARANCE_EVENT,
  APPEARANCE_KEY,
  applyTheme,
  isThemedPath,
  readAppearance,
  resolveTheme,
  userAppearanceKey,
  type Appearance,
} from "@/lib/appearance";

export function ThemeController({ pathname, userId }: { pathname: string; userId: string | null }) {
  const [appearance, setAppearance] = useState<Appearance>(() => readAppearance(userId));
  const [prefersLight, setPrefersLight] = useState(false);

  // Load this user's saved choice when the session changes, and make it the
  // device default so the next cold start paints it without a flash.
  useEffect(() => {
    const a = readAppearance(userId);
    setAppearance(a);
    const k = userAppearanceKey(userId);
    try {
      const own = k ? window.localStorage.getItem(k) : null;
      if (own) window.localStorage.setItem(APPEARANCE_KEY, own);
    } catch {
      /* storage unavailable */
    }
  }, [userId]);

  useEffect(() => {
    const onChange = (e: Event) => setAppearance((e as CustomEvent<Appearance>).detail);
    window.addEventListener(APPEARANCE_EVENT, onChange);
    return () => window.removeEventListener(APPEARANCE_EVENT, onChange);
  }, []);

  useEffect(() => {
    if (!window.matchMedia) return;
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    setPrefersLight(mq.matches);
    const onChange = () => setPrefersLight(mq.matches);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);

  useEffect(() => {
    applyTheme(isThemedPath(pathname) ? resolveTheme(appearance, prefersLight) : "midnight");
  }, [appearance, prefersLight, pathname]);

  return null;
}
