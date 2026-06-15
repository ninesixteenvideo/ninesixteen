import { getAdminDb } from "./firebaseAdmin";
import { hashHandoffSecret, secretsMatch } from "./authHandoffCrypto";

const SESSION_TTL_MS = 10 * 60 * 1000;

export type DesktopAuthSession = {
  uid: string;
  status: "ready";
  createdAt: number;
  expiresAt: number;
};

export async function registerDesktopAuthHandoff(
  code: string,
  secret: string,
  verifier: string
): Promise<boolean> {
  const db = getAdminDb();
  if (!db || !code || !secret || !verifier) return false;
  const now = Date.now();
  await db.collection("desktopAuthSessions").doc(code).set({
    secretHash: hashHandoffSecret(secret),
    // The user must type this short code (shown only in their desktop app) to
    // authorize the handoff — it stops a phished link from silently linking a
    // victim's account to an attacker-controlled handoff.
    verifierHash: hashHandoffSecret(verifier.toUpperCase()),
    status: "pending",
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS,
  });
  return true;
}

export async function markDesktopAuthReady(
  code: string,
  uid: string,
  verifier: string
): Promise<boolean> {
  const db = getAdminDb();
  if (!db || !code || !uid || !verifier) return false;
  const ref = db.collection("desktopAuthSessions").doc(code);
  const snap = await ref.get();
  if (!snap.exists) return false;
  const data = snap.data();
  if (!data?.secretHash) return false;
  if (typeof data.expiresAt === "number" && data.expiresAt < Date.now()) {
    await ref.delete();
    return false;
  }
  // The verification code must match the one the desktop app generated.
  if (
    typeof data.verifierHash !== "string" ||
    !secretsMatch(data.verifierHash, verifier.toUpperCase())
  ) {
    return false;
  }
  // Idempotent — React / Firestore can trigger duplicate complete calls.
  if (data.status === "ready" && data.uid === uid) return true;
  if (data.status !== "pending") return false;
  await ref.set(
    {
      ...data,
      uid,
      status: "ready",
    },
    { merge: true }
  );
  return true;
}

export async function consumeDesktopAuthSession(
  code: string,
  secret: string
): Promise<DesktopAuthSession | null> {
  const db = getAdminDb();
  if (!db || !code || !secret) return null;
  const ref = db.collection("desktopAuthSessions").doc(code);
  const snap = await ref.get();
  if (!snap.exists) return null;
  const data = snap.data();
  if (!data?.uid || data.status !== "ready") return null;
  if (typeof data.secretHash !== "string" || !secretsMatch(data.secretHash, secret)) {
    return null;
  }
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
