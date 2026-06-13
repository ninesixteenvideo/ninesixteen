"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  getDb,
  getFirebaseAuth,
  googleProvider,
  isFirebaseConfigured,
} from "./firebase";

export type Plan = "trial" | "pro";

export type NsUser = {
  uid: string;
  email: string;
  displayName: string | null;
  plan: Plan;
  /** True when running without real Firebase (local testing). */
  demo: boolean;
};

type AuthState = {
  user: NsUser | null;
  loading: boolean;
  firebaseEnabled: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, displayName: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  setPlan: (plan: Plan) => void;
};

const AuthContext = createContext<AuthState | null>(null);

const DEMO_KEY = "ns_demo_user";

function loadDemoUser(): NsUser | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(DEMO_KEY);
    return raw ? (JSON.parse(raw) as NsUser) : null;
  } catch {
    return null;
  }
}

function saveDemoUser(user: NsUser | null) {
  if (typeof window === "undefined") return;
  if (user) window.localStorage.setItem(DEMO_KEY, JSON.stringify(user));
  else window.localStorage.removeItem(DEMO_KEY);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<NsUser | null>(null);
  const [loading, setLoading] = useState(true);
  // Live Firestore subscription to the current user's entitlement doc.
  const planUnsub = useRef<() => void>(() => {});

  // Subscribe to users/{uid}.plan so a Stripe purchase reflects in real time.
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

  // Boot: subscribe to Firebase auth state, or restore demo session.
  useEffect(() => {
    let unsub = () => {};
    (async () => {
      const auth = getFirebaseAuth();
      if (auth) {
        const { onAuthStateChanged } = await import("firebase/auth");
        unsub = onAuthStateChanged(auth, (fbUser) => {
          if (fbUser) {
            setUser({
              uid: fbUser.uid,
              email: fbUser.email ?? "",
              displayName: fbUser.displayName,
              plan: "trial",
              demo: false,
            });
            void watchPlan(fbUser.uid);
          } else {
            planUnsub.current();
            planUnsub.current = () => {};
            setUser(null);
          }
          setLoading(false);
        });
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
      const { signInWithPopup } = await import("firebase/auth");
      await signInWithPopup(auth, googleProvider());
      return;
    }
    // Demo fallback so the button works without Firebase configured.
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

  const setPlan = useCallback((plan: Plan) => {
    setUser((prev) => {
      if (!prev) return prev;
      const next = { ...prev, plan };
      if (prev.demo) saveDemoUser(next);
      return next;
    });
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      user,
      loading,
      firebaseEnabled: isFirebaseConfigured,
      signIn,
      signUp,
      signInWithGoogle,
      signOut,
      setPlan,
    }),
    [user, loading, signIn, signUp, signInWithGoogle, signOut, setPlan]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}
