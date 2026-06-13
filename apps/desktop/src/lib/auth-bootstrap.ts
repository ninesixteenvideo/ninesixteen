import { isDesktop } from "./bridge";
import { getFirebaseAuth, isFirebaseConfigured } from "./firebase";

/**
 * Finish a pending Google redirect *once* before React mounts.
 * React StrictMode double-mounts effects and would otherwise consume or
 * miss the one-time redirect result in the Tauri webview.
 */
let bootPromise: Promise<void> | null = null;

export function bootstrapFirebaseAuth(): Promise<void> {
  if (!isFirebaseConfigured || !isDesktop) return Promise.resolve();
  if (bootPromise) return bootPromise;

  bootPromise = (async () => {
    const auth = getFirebaseAuth();
    if (!auth) return;

    const { getRedirectResult } = await import("firebase/auth");
    try {
      const result = await getRedirectResult(auth);
      if (result?.user) {
        console.info("[auth] Google redirect sign-in completed:", result.user.email);
      }
    } catch (e) {
      console.warn("[auth] getRedirectResult failed:", e);
    }
    await auth.authStateReady();
  })();

  return bootPromise;
}
