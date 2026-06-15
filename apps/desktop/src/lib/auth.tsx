import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { User } from "firebase/auth";
import { isProEntitlement, parseEntitlement, type Plan } from "@ninesixteen/brand";
import {
  getDb,
  getFirebaseAuth,
  googleProvider,
  isFirebaseConfigured,
  WEB_URL,
} from "./firebase";
import { isDesktop } from "./bridge";
import { syncUserProfile } from "./userSync";
import { signInViaDesktopBrowser } from "./desktopAuthHandoff";
import { clearStoredDriveToken } from "./driveAuth";
import {
  clearPersistedEntitlement,
  isOnline,
  loadPersistedEntitlement,
  savePersistedEntitlement,
} from "./entitlementCache";
import { invoke } from "./bridge";

export type { Plan };

export interface NsUser {
  uid: string;
  email: string;
  displayName: string | null;
  plan: Plan;
  demo: boolean;
}

interface AuthState {
  user: NsUser | null;
  loading: boolean;
  firebaseEnabled: boolean;
  isPro: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, displayName: string) => Promise<void>;
  signInWithGoogle: (onVerifier?: (code: string) => void) => Promise<void>;
  signOut: () => Promise<void>;
  openCheckout: () => Promise<void>;
  getIdToken: () => Promise<string | null>;
}

const AuthContext = createContext<AuthState | null>(null);

const DEMO_KEY = "ns_desktop_demo_user";

function loadDemoUser(): NsUser | null {
  try {
    const raw = window.localStorage.getItem(DEMO_KEY);
    return raw ? (JSON.parse(raw) as NsUser) : null;
  } catch {
    return null;
  }
}

function saveDemoUser(user: NsUser | null) {
  if (user) window.localStorage.setItem(DEMO_KEY, JSON.stringify(user));
  else window.localStorage.removeItem(DEMO_KEY);
}

async function syncEntitlementToRust(user: NsUser | null, getToken: () => Promise<string | null>) {
  if (!isDesktop) return;
  if (!user || user.demo) {
    await invoke("clear_entitlement");
    return;
  }

  const pro = isProEntitlement(user);
  await invoke("apply_entitlement_cache", {
    uid: user.uid,
    pro,
    proEndsAt: null,
  });

  if (!isOnline()) return;

  const token = await getToken();
  if (!token) return;

  try {
    await invoke("sync_entitlement", {
      idToken: token,
      uid: user.uid,
      proEndsAt: null,
    });
  } catch {
    /* offline or API unreachable — cached entitlement remains active */
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

function mapFirebaseUser(fbUser: User): NsUser {
  const base: NsUser = {
    uid: fbUser.uid,
    email: fbUser.email ?? "",
    displayName: fbUser.displayName,
    plan: "trial",
    demo: false,
  };
  const cached = loadPersistedEntitlement(fbUser.uid);
  if (!cached) return base;
  return { ...base, plan: cached.plan };
}

function persistUserEntitlement(user: NsUser) {
  if (user.demo) return;
  savePersistedEntitlement({
    uid: user.uid,
    plan: user.plan,
    updatedAt: Date.now(),
  });
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<NsUser | null>(null);
  const [loading, setLoading] = useState(true);
  const planUnsub = useRef<() => void>(() => {});

  const watchPlan = useCallback(async (uid: string) => {
    planUnsub.current();
    planUnsub.current = () => {};
    const db = getDb();
    if (!db) return;
    const { doc, onSnapshot } = await import("firebase/firestore");
    planUnsub.current = onSnapshot(doc(db, "users", uid), (snap) => {
      const ent = parseEntitlement(snap.data());
      setUser((prev) => {
        if (!prev || prev.uid !== uid) return prev;
        const next = { ...prev, plan: ent.plan };
        persistUserEntitlement(next);
        return next;
      });
    });
  }, []);

  useEffect(() => {
    let unsub = () => {};
    (async () => {
      const auth = getFirebaseAuth();
      if (auth) {
        const { onAuthStateChanged } = await import("firebase/auth");
        unsub = onAuthStateChanged(auth, (fbUser) => {
          if (fbUser) {
            setUser(mapFirebaseUser(fbUser));
            void syncUserProfile(fbUser);
            void watchPlan(fbUser.uid);
          } else {
            planUnsub.current();
            planUnsub.current = () => {};
            setUser(null);
          }
          setLoading(false);
        });
        if (auth.currentUser) {
          setUser(mapFirebaseUser(auth.currentUser));
          void syncUserProfile(auth.currentUser);
          void watchPlan(auth.currentUser.uid);
          setLoading(false);
        }
      } else {
        if (import.meta.env.PROD) {
          console.error(
            "[NineSixteen] Firebase is not configured — sign-in is disabled in production builds."
          );
          setUser(null);
        } else {
          setUser(loadDemoUser());
        }
        setLoading(false);
      }
    })();
    return () => {
      unsub();
      planUnsub.current();
    };
  }, [watchPlan]);

  const signIn = useCallback(async (email: string, password: string) => {
    const auth = getFirebaseAuth();
    if (auth) {
      const { signInWithEmailAndPassword } = await import("firebase/auth");
      await signInWithEmailAndPassword(auth, email, password);
      return;
    }
    if (import.meta.env.PROD) {
      throw new Error("Sign-in is unavailable — Firebase is not configured.");
    }
    const demoUser: NsUser = {
      uid: "demo-" + btoa(email).slice(0, 10),
      email,
      displayName: email.split("@")[0],
      plan: "trial",
      demo: true,
    };
    saveDemoUser(demoUser);
    setUser(demoUser);
  }, []);

  const signUp = useCallback(
    async (email: string, password: string, displayName: string) => {
      const auth = getFirebaseAuth();
      if (auth) {
        const { createUserWithEmailAndPassword, updateProfile } = await import(
          "firebase/auth"
        );
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        if (displayName) await updateProfile(cred.user, { displayName });
        return;
      }
      if (import.meta.env.PROD) {
        throw new Error("Sign-up is unavailable — Firebase is not configured.");
      }
      const demoUser: NsUser = {
        uid: "demo-" + btoa(email).slice(0, 10),
        email,
        displayName: displayName || email.split("@")[0],
        plan: "trial",
        demo: true,
      };
      saveDemoUser(demoUser);
      setUser(demoUser);
    },
    []
  );

  const signInWithGoogle = useCallback(async (onVerifier?: (code: string) => void) => {
    const auth = getFirebaseAuth();
    if (auth) {
      if (isDesktop) {
        await signInViaDesktopBrowser(onVerifier);
        return;
      }
      const { signInWithPopup } = await import("firebase/auth");
      await signInWithPopup(auth, googleProvider());
      return;
    }
    if (import.meta.env.PROD) {
      throw new Error("Sign-in is unavailable — Firebase is not configured.");
    }
    const demoUser: NsUser = {
      uid: "demo-google",
      email: "you@gmail.com",
      displayName: "Google Tester",
      plan: "trial",
      demo: true,
    };
    saveDemoUser(demoUser);
    setUser(demoUser);
  }, []);

  const signOut = useCallback(async () => {
    planUnsub.current();
    planUnsub.current = () => {};
    clearStoredDriveToken();
    clearPersistedEntitlement();
    void syncEntitlementToRust(null, async () => null);
    const auth = getFirebaseAuth();
    if (auth) {
      const { signOut: fbSignOut } = await import("firebase/auth");
      await fbSignOut(auth);
      return;
    }
    saveDemoUser(null);
    setUser(null);
  }, []);

  const openCheckout = useCallback(async () => {
    const url = new URL("/checkout", WEB_URL);
    if (user?.uid) url.searchParams.set("uid", user.uid);
    if (user?.email) url.searchParams.set("email", user.email);
    await openExternal(url.toString());
  }, [user]);

  const getIdToken = useCallback(async (): Promise<string | null> => {
    const auth = getFirebaseAuth();
    if (!auth?.currentUser) return null;
    return auth.currentUser.getIdToken();
  }, []);

  useEffect(() => {
    if (!user || user.demo) {
      void syncEntitlementToRust(null, async () => null);
      return;
    }
    void syncEntitlementToRust(user, getIdToken);
  }, [user, getIdToken]);

  const value = useMemo<AuthState>(
    () => ({
      user,
      loading,
      firebaseEnabled: isFirebaseConfigured,
      isPro: user ? isProEntitlement(user) : false,
      signIn,
      signUp,
      signInWithGoogle,
      signOut,
      openCheckout,
      getIdToken,
    }),
    [user, loading, signIn, signUp, signInWithGoogle, signOut, openCheckout, getIdToken]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}
