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
  formatProEndDate,
  isProEntitlement,
  parseEntitlement,
  subscriptionCancelled,
  type Plan,
} from "@ninesixteen/brand";
import {
  getDb,
  getFirebaseAuth,
  googleProvider,
  isFirebaseConfigured,
  WEB_URL,
} from "./firebase";
import { isDesktop } from "./bridge";
import { syncUserProfile } from "./userSync";

export type { Plan };

export interface NsUser {
  uid: string;
  email: string;
  displayName: string | null;
  plan: Plan;
  proEndsAt: number | null;
  subscriptionCancelAtPeriodEnd: boolean;
  demo: boolean;
}

interface AuthState {
  user: NsUser | null;
  loading: boolean;
  firebaseEnabled: boolean;
  isPro: boolean;
  subscriptionCancelled: boolean;
  proEndsAt: number | null;
  formatProEndDate: (ms: number) => string;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, displayName: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  openCheckout: (interval: "monthly" | "yearly") => Promise<void>;
  openBillingPortal: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

const DEMO_KEY = "ns_desktop_demo_user";

const emptyEntitlement = {
  proEndsAt: null as number | null,
  subscriptionCancelAtPeriodEnd: false,
};

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
    ...emptyEntitlement,
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
      const ent = parseEntitlement(snap.data());
      setUser((prev) =>
        prev && prev.uid === uid
          ? {
              ...prev,
              plan: ent.plan,
              proEndsAt: ent.proEndsAt,
              subscriptionCancelAtPeriodEnd: ent.subscriptionCancelAtPeriodEnd,
            }
          : prev
      );
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
      ...emptyEntitlement,
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
        ...emptyEntitlement,
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
      ...emptyEntitlement,
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

  const openBillingPortal = useCallback(async () => {
    const auth = getFirebaseAuth();
    if (!auth?.currentUser) return;
    const token = await auth.currentUser.getIdToken();
    const res = await fetch(`${WEB_URL}/api/stripe/portal`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = (await res.json()) as { url?: string };
    if (data.url) await openExternal(data.url);
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      user,
      loading,
      firebaseEnabled: isFirebaseConfigured,
      isPro: user ? isProEntitlement(user) : false,
      subscriptionCancelled: user ? subscriptionCancelled(user) : false,
      proEndsAt: user?.proEndsAt ?? null,
      formatProEndDate,
      signIn,
      signUp,
      signInWithGoogle,
      signOut,
      openCheckout,
      openBillingPortal,
    }),
    [user, loading, signIn, signUp, signInWithGoogle, signOut, openCheckout, openBillingPortal]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}
