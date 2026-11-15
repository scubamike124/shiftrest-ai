import type { ReactNode } from "react";
import { useIsNativeApp } from "@/lib/native-app";

/** Renders its children on the website and nothing inside the app shell.
 *  Used to hide purchase and trial calls to action in the iPhone app. */
export function WebOnly({ children }: { children: ReactNode }) {
  return useIsNativeApp() ? null : <>{children}</>;
}
