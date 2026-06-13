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
import { getAuth as getFirebaseAdminAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore, type Firestore } from "firebase-admin/firestore";

const projectId = (process.env.FIREBASE_PROJECT_ID ?? "").trim();
const clientEmail = (process.env.FIREBASE_CLIENT_EMAIL ?? "").trim();
const privateKey = normalizePrivateKey(process.env.FIREBASE_PRIVATE_KEY ?? "");

function normalizePrivateKey(raw: string): string {
  let key = raw.trim();
  if (
    (key.startsWith('"') && key.endsWith('"')) ||
    (key.startsWith("'") && key.endsWith("'"))
  ) {
    key = key.slice(1, -1);
  }
  return key.replace(/\\n/g, "\n");
}

export const isAdminConfigured = Boolean(projectId && clientEmail && privateKey);

let adminApp: App | null = null;

function getAdminApp(): App | null {
  if (!isAdminConfigured) return null;
  if (!adminApp) {
    try {
      adminApp = getApps().length
        ? getApps()[0]!
        : initializeApp({
            credential: cert({ projectId, clientEmail, privateKey }),
            projectId,
          });
    } catch (err) {
      console.error("[firebaseAdmin] initializeApp failed:", err);
      return null;
    }
  }
  return adminApp;
}

export function getAdminDb(): Firestore | null {
  const a = getAdminApp();
  if (!a) return null;
  return getFirestore(a);
}

/** Verify a Firebase ID token from the client (web or desktop). */
export async function verifyUserIdToken(
  token: string
): Promise<{ uid: string; email?: string; name?: string; emailVerified: boolean } | null> {
  const app = getAdminApp();
  if (!app) return null;
  try {
    const decoded = await getFirebaseAdminAuth(app).verifyIdToken(token);
    return {
      uid: decoded.uid,
      email: decoded.email,
      name: decoded.name,
      emailVerified: decoded.email_verified === true,
    };
  } catch {
    return null;
  }
}

type EntitlementUpdate = {
  plan: "trial" | "pro";
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  subscriptionStatus?: string;
  /** When Pro access ends (ms). Set when user cancels but keeps access until period end. */
  proEndsAt?: number | null;
  subscriptionCancelAtPeriodEnd?: boolean;
};

function entitlementPayload(update: EntitlementUpdate): Record<string, unknown> {
  const payload: Record<string, unknown> = { ...update, updatedAt: Date.now() };
  if (update.proEndsAt === null) payload.proEndsAt = FieldValue.delete();
  if (update.subscriptionCancelAtPeriodEnd === false) {
    payload.subscriptionCancelAtPeriodEnd = FieldValue.delete();
  }
  return payload;
}

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
    .set(entitlementPayload(update), { merge: true });
  return true;
}

export type { EntitlementUpdate };

/** Create or refresh a user profile on sign-in. Preserves an existing Pro plan. */
export async function upsertUserProfileOnSignIn(
  uid: string,
  profile: { email?: string | null; displayName?: string | null }
): Promise<"trial" | "pro" | null> {
  const dbAdmin = getAdminDb();
  if (!dbAdmin || !uid) return null;
  const ref = dbAdmin.collection("users").doc(uid);
  const existing = await ref.get();
  const data = existing.data();
  const now = Date.now();
  const stillPro =
    data?.plan === "pro" && (!data?.proEndsAt || data.proEndsAt > now);
  const plan: "trial" | "pro" = stillPro ? "pro" : "trial";
  await ref.set(
    {
      email: profile.email ?? data?.email ?? "",
      displayName: profile.displayName ?? data?.displayName ?? null,
      plan,
      createdAt: data?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
      lastSignInAt: Date.now(),
    },
    { merge: true }
  );
  return plan;
}

/** Issue a Firebase custom token so the desktop app can sign in after browser OAuth. */
export async function createCustomToken(uid: string): Promise<string | null> {
  const app = getAdminApp();
  if (!app || !uid) return null;
  try {
    return await getFirebaseAdminAuth(app).createCustomToken(uid);
  } catch (err) {
    console.error("[firebaseAdmin] createCustomToken failed:", err);
    return null;
  }
}
