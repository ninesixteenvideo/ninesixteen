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
import {
  getDb,
  getFirebaseAuth,
  googleProvider,
  isFirebaseConfigured,
  WEB_URL,
} from "./firebase";
import { isDesktop } from "./bridge";

export type Plan = "trial" | "pro";

export interface NsUser {
  uid: string;
  email: string;
  displayName: string | null;
  plan: Plan;
  /** True when running without real Firebase (local testing). */
  demo: boolean;
}

interface AuthState {
  user: NsUser | null;
  loading: boolean;
  firebaseEnabled: boolean;
  isPro: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, displayName: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  /** Open the web checkout in the system browser, tied to this account. */
  openCheckout: (interval: "monthly" | "yearly") => Promise<void>;
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

async function openExternal(url: string) {
  try {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
  } catch {
    window.open(url, "_blank");
  }
}

function mapFirebaseUser(fbUser: User): NsUser {
  return {
    uid: fbUser.uid,
    email: fbUser.email ?? "",
    displayName: fbUser.displayName,
    plan: "trial",
    demo: false,
  };
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
      const plan = (snap.data()?.plan as Plan) ?? "trial";
      setUser((prev) => (prev && prev.uid === uid ? { ...prev, plan } : prev));
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
            void watchPlan(fbUser.uid);
          } else {
            planUnsub.current();
            planUnsub.current = () => {};
            setUser(null);
          }
          setLoading(false);
        });
        // Belt-and-suspenders: listener may lag behind persisted session restore.
        if (auth.currentUser) {
          setUser(mapFirebaseUser(auth.currentUser));
          void watchPlan(auth.currentUser.uid);
          setLoading(false);
        }
      } else {
        setUser(loadDemoUser());
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

  const signInWithGoogle = useCallback(async () => {
    const auth = getFirebaseAuth();
    if (auth) {
      const { signInWithPopup, signInWithRedirect } = await import("firebase/auth");
      const provider = googleProvider();
      // Tauri / WebView2 blocks OAuth popups — redirect in the same window instead.
      if (isDesktop) {
        await signInWithRedirect(auth, provider);
        return;
      }
      await signInWithPopup(auth, provider);
      return;
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
    const auth = getFirebaseAuth();
    if (auth) {
      const { signOut: fbSignOut } = await import("firebase/auth");
      await fbSignOut(auth);
      return;
    }
    saveDemoUser(null);
    setUser(null);
  }, []);

  const openCheckout = useCallback(
    async (interval: "monthly" | "yearly") => {
      const url = new URL("/checkout", WEB_URL);
      url.searchParams.set("interval", interval);
      if (user?.uid) url.searchParams.set("uid", user.uid);
      if (user?.email) url.searchParams.set("email", user.email);
      await openExternal(url.toString());
    },
    [user]
  );

  const value = useMemo<AuthState>(
    () => ({
      user,
      loading,
      firebaseEnabled: isFirebaseConfigured,
      isPro: user?.plan === "pro",
      signIn,
      signUp,
      signInWithGoogle,
      signOut,
      openCheckout,
    }),
    [user, loading, signIn, signUp, signInWithGoogle, signOut, openCheckout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}
