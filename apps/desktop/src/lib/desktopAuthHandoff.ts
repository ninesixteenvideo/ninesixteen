import { getFirebaseAuth, WEB_URL } from "./firebase";
import { isDesktop } from "./bridge";
import { registerAuthHandoff } from "./handoffRegister";

async function openExternal(url: string) {
  try {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
  } catch {
    window.open(url, "_blank");
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Desktop Google sign-in via the system browser.
 * WebView2 loses Firebase redirect state; this flow signs in on the web app
 * and exchanges a one-time custom token back to the desktop app.
 */
export async function signInViaDesktopBrowser(): Promise<void> {
  if (!isDesktop) {
    throw new Error("Desktop browser sign-in is only available in the desktop app.");
  }

  const auth = getFirebaseAuth();
  if (!auth) throw new Error("Firebase is not configured.");

  const code = crypto.randomUUID();
  const secret = crypto.randomUUID();
  await registerAuthHandoff("desktop", code, secret);

  const url = new URL("/auth/desktop", WEB_URL);
  url.searchParams.set("code", code);
  await openExternal(url.toString());

  const deadline = Date.now() + 5 * 60 * 1000;
  let polls = 0;
  while (Date.now() < deadline) {
    // First poll sooner so a fast browser sign-in feels instant.
    await sleep(polls === 0 ? 800 : 2000);
    polls += 1;

    let res: Response;
    try {
      const poll = new URL(`${WEB_URL}/api/auth/desktop/session`);
      poll.searchParams.set("code", code);
      poll.searchParams.set("secret", secret);
      res = await fetch(poll.toString());
    } catch {
      continue;
    }

    if (res.status === 429) {
      await sleep(3000);
      continue;
    }

    const data = (await res.json().catch(() => ({}))) as {
      status?: string;
      customToken?: string;
      error?: string;
    };

    if (data.error && data.status !== "pending") {
      throw new Error(data.error);
    }

    if (data.status === "ready" && data.customToken) {
      const { signInWithCustomToken } = await import("firebase/auth");
      await signInWithCustomToken(auth, data.customToken);
      return;
    }
  }

  throw new Error(
    "Sign-in timed out. Finish signing in in your browser, then try again."
  );
}
