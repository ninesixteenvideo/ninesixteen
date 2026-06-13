import { WEB_URL } from "./firebase";

const TOKEN_KEY = "ns_drive_access_token";
const EXPIRES_KEY = "ns_drive_access_token_expires";

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
  const token = localStorage.getItem(TOKEN_KEY);
  const expires = Number(localStorage.getItem(EXPIRES_KEY) ?? "0");
  if (!token || !expires || Date.now() >= expires - 60_000) {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(EXPIRES_KEY);
    return null;
  }
  return token;
}

function storeDriveToken(accessToken: string, expiresInSec: number) {
  localStorage.setItem(TOKEN_KEY, accessToken);
  localStorage.setItem(EXPIRES_KEY, String(Date.now() + expiresInSec * 1000));
}

/** Connect Google Drive via the system browser (OAuth token handoff). */
export async function connectGoogleDrive(): Promise<string> {
  const code = crypto.randomUUID();
  const url = new URL("/auth/drive", WEB_URL);
  url.searchParams.set("code", code);
  await openExternal(url.toString());

  const deadline = Date.now() + 5 * 60 * 1000;
  while (Date.now() < deadline) {
    await sleep(2000);
    let res: Response;
    try {
      res = await fetch(
        `${WEB_URL}/api/auth/drive/session?code=${encodeURIComponent(code)}`
      );
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
