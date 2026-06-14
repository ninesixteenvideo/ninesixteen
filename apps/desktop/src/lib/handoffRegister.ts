import { WEB_URL } from "./firebase";
import { friendlyAuthError } from "./authErrors";

export async function registerAuthHandoff(
  kind: "desktop" | "drive",
  code: string,
  secret: string
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${WEB_URL}/api/auth/handoff/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, secret, kind }),
    });
  } catch (error) {
    throw new Error(friendlyAuthError(error));
  }

  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? "Could not start secure handoff");
  }
}
