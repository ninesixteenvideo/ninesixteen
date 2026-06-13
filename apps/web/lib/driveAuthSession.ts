import { getAdminDb } from "./firebaseAdmin";

const SESSION_TTL_MS = 10 * 60 * 1000;

export async function markDriveAuthReady(
  code: string,
  accessToken: string,
  expiresInSec: number
): Promise<boolean> {
  const db = getAdminDb();
  if (!db || !code || !accessToken) return false;
  const now = Date.now();
  await db
    .collection("driveAuthSessions")
    .doc(code)
    .set({
      accessToken,
      expiresIn: expiresInSec,
      createdAt: now,
      expiresAt: now + SESSION_TTL_MS,
    });
  return true;
}

export async function consumeDriveAuthSession(
  code: string
): Promise<{ accessToken: string; expiresIn: number } | null> {
  const db = getAdminDb();
  if (!db || !code) return null;
  const ref = db.collection("driveAuthSessions").doc(code);
  const snap = await ref.get();
  if (!snap.exists) return null;
  const data = snap.data();
  if (!data) return null;
  if (typeof data.expiresAt === "number" && data.expiresAt < Date.now()) {
    await ref.delete();
    return null;
  }
  const accessToken = data.accessToken as string | undefined;
  if (!accessToken) return null;
  await ref.delete();
  return {
    accessToken,
    expiresIn: typeof data.expiresIn === "number" ? data.expiresIn : 3600,
  };
}
