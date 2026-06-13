import { getAdminDb } from "./firebaseAdmin";

const SESSION_TTL_MS = 10 * 60 * 1000;

export type DesktopAuthSession = {
  uid: string;
  status: "ready";
  createdAt: number;
  expiresAt: number;
};

export async function markDesktopAuthReady(
  code: string,
  uid: string
): Promise<boolean> {
  const db = getAdminDb();
  if (!db || !code || !uid) return false;
  const now = Date.now();
  await db
    .collection("desktopAuthSessions")
    .doc(code)
    .set({
      uid,
      status: "ready",
      createdAt: now,
      expiresAt: now + SESSION_TTL_MS,
    });
  return true;
}

export async function consumeDesktopAuthSession(
  code: string
): Promise<DesktopAuthSession | null> {
  const db = getAdminDb();
  if (!db || !code) return null;
  const ref = db.collection("desktopAuthSessions").doc(code);
  const snap = await ref.get();
  if (!snap.exists) return null;
  const data = snap.data();
  if (!data?.uid || data.status !== "ready") return null;
  if (typeof data.expiresAt === "number" && data.expiresAt < Date.now()) {
    await ref.delete();
    return null;
  }
  await ref.delete();
  return {
    uid: data.uid as string,
    status: "ready",
    createdAt: data.createdAt as number,
    expiresAt: data.expiresAt as number,
  };
}
