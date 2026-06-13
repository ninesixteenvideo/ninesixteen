/**
 * Firebase client for the desktop app.
 *
 * Uses the SAME Firebase project as the web app (set via VITE_FIREBASE_*),
 * so a user's uid — and therefore their Pro entitlement stored in Firestore
 * `users/{uid}.plan` — is identical across web and desktop. A purchase made
 * in the browser unlocks export here in real time via an onSnapshot listener.
 *
 * Auth uses local persistence so sign-in survives restarts. Firestore uses
 * IndexedDB persistence so entitlement reads work offline after first sync.
 */
import { initializeApp, getApps, getApp, type FirebaseApp } from "firebase/app";
import {
  browserLocalPersistence,
  browserPopupRedirectResolver,
  getAuth,
  GoogleAuthProvider,
  initializeAuth,
  type Auth,
} from "firebase/auth";
import { enableIndexedDbPersistence, getFirestore, type Firestore } from "firebase/firestore";

const env = import.meta.env;

const config = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
};

export const isFirebaseConfigured = Boolean(
  config.apiKey && config.authDomain && config.projectId && config.appId
);

/** Base URL of the web app, used to open checkout in the system browser. */
export const WEB_URL: string = env.VITE_WEB_URL || "https://ninesixteen.video";

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Firestore | null = null;
let persistenceEnabled = false;

function ensureApp(): FirebaseApp | null {
  if (!isFirebaseConfigured) return null;
  if (!app) app = getApps().length ? getApp() : initializeApp(config);
  return app;
}

export function getFirebaseAuth(): Auth | null {
  const a = ensureApp();
  if (!a) return null;
  if (!auth) {
    try {
      auth = initializeAuth(a, {
        persistence: browserLocalPersistence,
        popupRedirectResolver: browserPopupRedirectResolver,
      });
    } catch {
      auth = getAuth(a);
    }
  }
  return auth;
}

export function getDb(): Firestore | null {
  const a = ensureApp();
  if (!a) return null;
  if (!db) {
    db = getFirestore(a);
    if (!persistenceEnabled) {
      persistenceEnabled = true;
      void enableIndexedDbPersistence(db).catch(() => {
        /* private mode or multi-tab — online-only fallback */
      });
    }
  }
  return db;
}

export function googleProvider(): GoogleAuthProvider {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  return provider;
}
