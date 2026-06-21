"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { useAuth } from "@/lib/auth";

function AuthFormInner({
  mode,
  onAuthenticated,
  embedded = false,
  onSwitchMode,
}: {
  mode: "sign-in" | "sign-up";
  onAuthenticated?: (next?: string) => void;
  embedded?: boolean;
  onSwitchMode?: (mode: "sign-in" | "sign-up") => void;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { signIn, signUp, signInWithGoogle, firebaseEnabled } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isSignUp = mode === "sign-up";

  function afterAuth() {
    if (onAuthenticated) {
      onAuthenticated();
      return;
    }
    const next = searchParams.get("next");
    if (next?.startsWith("/")) {
      router.push(next);
      return;
    }
    router.push("/dashboard");
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (isSignUp) await signUp(email, password, name);
      else await signIn(email, password);
      if (onAuthenticated) onAuthenticated();
      else afterAuth();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  async function onGoogle() {
    setError(null);
    setBusy(true);
    try {
      await signInWithGoogle();
      if (onAuthenticated) onAuthenticated();
      else afterAuth();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Google sign-in failed.");
    } finally {
      setBusy(false);
    }
  }

  const body = (
    <>
      {!embedded ? (
        <>
          <p className="home-auth__kicker">{isSignUp ? "New account" : "Welcome back"}</p>
          <h1 className="home-auth__heading">
            {isSignUp ? "Create your account" : "Sign in"}
          </h1>
          <p className="home-auth__lede">
            {isSignUp
              ? "Sync Pro across desktop and web."
              : "Manage your license and exports."}
          </p>
        </>
      ) : null}

      {!firebaseEnabled && (
        <div className="home-auth__notice">
          Demo mode: Firebase isn&apos;t configured — accounts stay in this browser only.
        </div>
      )}

      <button
        type="button"
        onClick={onGoogle}
        disabled={busy}
        className="home-auth__action home-auth__action--oauth"
      >
        <span className="home-auth__action-eyebrow">One tap</span>
        <span className="home-auth__action-main">
          <GoogleGlyph />
          <span className="home-auth__action-title home-auth__action-title--mono">Google</span>
        </span>
        <span className="home-auth__action-meta">Continue with Google</span>
      </button>

      <div className="home-auth__divider">
        <span>or with email</span>
      </div>

      <form onSubmit={onSubmit} className="home-auth__form">
        {isSignUp && (
          <Field label="Name">
            <input
              className="home-auth__input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ada Lovelace"
              autoComplete="name"
            />
          </Field>
        )}
        <Field label="Email">
          <input
            className="home-auth__input"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@studio.com"
            autoComplete="email"
          />
        </Field>
        <Field label="Password">
          <input
            className="home-auth__input"
            type="password"
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            autoComplete={isSignUp ? "new-password" : "current-password"}
          />
        </Field>

        {error ? <p className="home-auth__error">{error}</p> : null}

        <button
          type="submit"
          disabled={busy}
          className={`home-auth__action ${isSignUp ? "home-auth__action--coral" : "home-auth__action--mint"}`}
        >
          <span className="home-auth__action-eyebrow">
            {isSignUp ? "New account" : "Welcome back"}
          </span>
          <span className="home-auth__action-title">
            {busy ? "…" : isSignUp ? "Create account" : "Sign in"}
          </span>
          <span className="home-auth__action-meta">
            {isSignUp ? "Sync Pro everywhere" : "Manage your license"}
          </span>
        </button>
      </form>

      {isSignUp && (
        <p className="home-auth__fine">
          By creating an account, you agree to our{" "}
          <Link href="/terms" className="home-auth__link">
            Terms
          </Link>{" "}
          and{" "}
          <Link href="/privacy" className="home-auth__link">
            Privacy
          </Link>
          .
        </p>
      )}

      <p className="home-auth__switch">
        {isSignUp ? (
          <>
            Already have an account?{" "}
            {embedded && onSwitchMode ? (
              <button type="button" className="home-auth__link-btn" onClick={() => onSwitchMode("sign-in")}>
                Sign in
              </button>
            ) : (
              <Link href="/?view=sign-in" className="home-auth__link">
                Sign in
              </Link>
            )}
          </>
        ) : (
          <>
            New here?{" "}
            {embedded && onSwitchMode ? (
              <button type="button" className="home-auth__link-btn" onClick={() => onSwitchMode("sign-up")}>
                Create an account
              </button>
            ) : (
              <Link href="/?view=sign-up" className="home-auth__link">
                Create an account
              </Link>
            )}
          </>
        )}
      </p>
    </>
  );

  if (embedded) {
    return <div className="home-auth home-auth--embedded">{body}</div>;
  }

  return (
    <div className="home-auth home-auth--page">
      <div className="home-auth__console">{body}</div>
    </div>
  );
}

function GoogleGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.71-1.57 2.68-3.89 2.68-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.72A5.4 5.4 0 0 1 3.68 9c0-.6.1-1.18.29-1.72V4.95H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.05l3.01-2.33Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z"
      />
    </svg>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="home-auth__field">
      <span className="home-auth__label">{label}</span>
      {children}
    </label>
  );
}

export function AuthForm({
  mode,
  onAuthenticated,
  embedded = false,
  onSwitchMode,
}: {
  mode: "sign-in" | "sign-up";
  onAuthenticated?: (next?: string) => void;
  embedded?: boolean;
  onSwitchMode?: (mode: "sign-in" | "sign-up") => void;
}) {
  return (
    <Suspense
      fallback={
        <div className="home-auth home-auth--page">
          <p className="home-auth__meta">Loading…</p>
        </div>
      }
    >
      <AuthFormInner
        mode={mode}
        onAuthenticated={onAuthenticated}
        embedded={embedded}
        onSwitchMode={onSwitchMode}
      />
    </Suspense>
  );
}
