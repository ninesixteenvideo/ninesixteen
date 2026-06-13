/**
 * Firebase Admin (server-side) — used by the Stripe webhook to write a user's
 * Pro entitlement to Firestore. This is the single source of truth that both
 * the web app and the desktop app read from.
 *
 * Requires a service account. Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL
 * and FIREBASE_PRIVATE_KEY in the environment (see .env.example). If they are
 * absent we run in "mock" mode and skip persistence so local dev still works.
 */
import { getApps, initializeApp, cert, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

const projectId = process.env.FIREBASE_PROJECT_ID ?? "";
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL ?? "";
// Private keys in env files keep their newlines escaped — unescape them here.
const privateKey = (process.env.FIREBASE_PRIVATE_KEY ?? "").replace(/\\n/g, "\n");

export const isAdminConfigured = Boolean(projectId && clientEmail && privateKey);

let adminApp: App | null = null;

function getAdminApp(): App | null {
  if (!isAdminConfigured) return null;
  if (!adminApp) {
    adminApp = getApps().length
      ? getApps()[0]!
      : initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
  }
  return adminApp;
}

export function getAdminDb(): Firestore | null {
  const a = getAdminApp();
  if (!a) return null;
  return getFirestore(a);
}

type EntitlementUpdate = {
  plan: "trial" | "pro";
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  subscriptionStatus?: string;
};

/** Upsert a user's entitlement document. No-op in mock mode. */
export async function setUserEntitlement(
  uid: string,
  update: EntitlementUpdate
): Promise<boolean> {
  const dbAdmin = getAdminDb();
  if (!dbAdmin || !uid) return false;
  await dbAdmin
    .collection("users")
    .doc(uid)
    .set({ ...update, updatedAt: Date.now() }, { merge: true });
  return true;
}
