import { getAdminDb } from "./firebaseAdmin";
import { hashHandoffSecret, secretsMatch } from "./authHandoffCrypto";

const SESSION_TTL_MS = 10 * 60 * 1000;

export async function registerDriveAuthHandoff(
  code: string,
  secret: string
): Promise<boolean> {
  const db = getAdminDb();
  if (!db || !code || !secret) return false;
  const now = Date.now();
  await db.collection("driveAuthSessions").doc(code).set({
    secretHash: hashHandoffSecret(secret),
    status: "pending",
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS,
  });
  return true;
}

export async function markDriveAuthReady(
  code: string,
  secret: string,
  accessToken: string,
  expiresInSec: number
): Promise<boolean> {
  const db = getAdminDb();
  if (!db || !code || !secret || !accessToken) return false;
  const ref = db.collection("driveAuthSessions").doc(code);
  const snap = await ref.get();
  if (!snap.exists) return false;
  const data = snap.data();
  if (!data?.secretHash || data.status !== "pending") return false;
  if (!secretsMatch(data.secretHash, secret)) return false;
  if (typeof data.expiresAt === "number" && data.expiresAt < Date.now()) {
    await ref.delete();
    return false;
  }
  await ref.set(
    {
      ...data,
      accessToken,
      expiresIn: expiresInSec,
      status: "ready",
    },
    { merge: true }
  );
  return true;
}

export async function consumeDriveAuthSession(
  code: string,
  secret: string
): Promise<{ accessToken: string; expiresIn: number } | null> {
  const db = getAdminDb();
  if (!db || !code || !secret) return null;
  const ref = db.collection("driveAuthSessions").doc(code);
  const snap = await ref.get();
  if (!snap.exists) return null;
  const data = snap.data();
  if (data?.status !== "ready") return null;
  if (typeof data.secretHash !== "string" || !secretsMatch(data.secretHash, secret)) {
    return null;
  }
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
