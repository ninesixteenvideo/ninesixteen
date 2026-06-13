import { WEB_URL } from "./firebase";
import { registerAuthHandoff } from "./handoffRegister";

/** Session-only storage — cleared when the app/WebView session ends. */
const TOKEN_KEY = "ns_drive_access_token";
const EXPIRES_KEY = "ns_drive_access_token_expires";
const LEGACY_TOKEN_KEY = "ns_drive_access_token";
const LEGACY_EXPIRES_KEY = "ns_drive_access_token_expires";

/** Google access tokens are short-lived; never cache longer than one hour. */
const MAX_CACHE_SEC = 3600;

function storage(): Storage {
  return sessionStorage;
}

/** Drop any tokens persisted before we moved off localStorage. */
function clearLegacyDriveTokenStorage() {
  try {
    localStorage.removeItem(LEGACY_TOKEN_KEY);
    localStorage.removeItem(LEGACY_EXPIRES_KEY);
  } catch {
    /* ignore */
  }
}

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

export function getStoredDriveToken(): string | null {
  clearLegacyDriveTokenStorage();
  const token = storage().getItem(TOKEN_KEY);
  const expires = Number(storage().getItem(EXPIRES_KEY) ?? "0");
  if (!token || !expires || Date.now() >= expires - 60_000) {
    clearStoredDriveToken();
    return null;
  }
  return token;
}

function storeDriveToken(accessToken: string, expiresInSec: number) {
  const ttlSec = Math.min(Math.max(expiresInSec, 60), MAX_CACHE_SEC);
  storage().setItem(TOKEN_KEY, accessToken);
  storage().setItem(EXPIRES_KEY, String(Date.now() + ttlSec * 1000));
}

/** Connect Google Drive via the system browser (OAuth token handoff). */
export async function connectGoogleDrive(): Promise<string> {
  const code = crypto.randomUUID();
  const secret = crypto.randomUUID();
  await registerAuthHandoff("drive", code, secret);

  const url = new URL("/auth/drive", WEB_URL);
  url.searchParams.set("code", code);
  url.searchParams.set("handoff", secret);
  await openExternal(url.toString());

  const deadline = Date.now() + 5 * 60 * 1000;
  while (Date.now() < deadline) {
    await sleep(2000);
    let res: Response;
    try {
      const poll = new URL(`${WEB_URL}/api/auth/drive/session`);
      poll.searchParams.set("code", code);
      poll.searchParams.set("secret", secret);
      res = await fetch(poll.toString());
    } catch {
      continue;
    }
    const data = (await res.json()) as {
      status?: string;
      accessToken?: string;
      expiresIn?: number;
    };
    if (data.status === "ready" && data.accessToken) {
      storeDriveToken(data.accessToken, data.expiresIn ?? 3600);
      return data.accessToken;
    }
  }

  throw new Error(
    "Google Drive connection timed out. Finish authorizing in your browser, then try again."
  );
}

export async function ensureDriveToken(): Promise<string> {
  const existing = getStoredDriveToken();
  if (existing) return existing;
  return connectGoogleDrive();
}

export function clearStoredDriveToken() {
  clearLegacyDriveTokenStorage();
  storage().removeItem(TOKEN_KEY);
  storage().removeItem(EXPIRES_KEY);
}
