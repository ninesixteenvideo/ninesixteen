import { useState } from "react";
import { friendlyAuthError } from "../lib/authErrors";
import { useAuth } from "../lib/auth";
import { isDesktop } from "../lib/bridge";
import { WEB_URL } from "../lib/firebase";
import { Reveal } from "./Reveal";

async function openLegalPage(path: "/terms" | "/privacy") {
  const url = `${WEB_URL}${path}`;
  try {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
  } catch {
    window.open(url, "_blank");
  }
}

/**
 * Compact sign-in / sign-up panel used inside the account card and the paywall.
 * Google-first, with email/password as a fallback.
 */
export function AuthPanel({ onDone }: { onDone?: () => void }) {
  const { signIn, signUp, signInWithGoogle, firebaseEnabled } = useAuth();
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-up");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [verifierCode, setVerifierCode] = useState<string | null>(null);

  const isSignUp = mode === "sign-up";

  async function run(fn: () => Promise<void>) {
    setError(null);
    setVerifierCode(null);
    setBusy(true);
    try {
      await fn();
      onDone?.();
    } catch (e) {
      setError(friendlyAuthError(e));
    } finally {
      setBusy(false);
      setVerifierCode(null);
    }
  }

  return (
    <div className="auth">
      <button
        className="gbtn"
        disabled={busy}
        onClick={() => run(() => signInWithGoogle(setVerifierCode))}
      >
        <GoogleGlyph /> Continue with Google
      </button>
      <Reveal show={isDesktop && firebaseEnabled && !verifierCode}>
        <p className="auth-note">
          Opens your browser to sign in with Google, then links your account back here
          automatically.
        </p>
      </Reveal>
      <Reveal show={Boolean(verifierCode)}>
        <div className="verifier">
          <p className="muted">In your browser, enter this code to finish signing in:</p>
          <p className="verifier-code">{verifierCode}</p>
        </div>
      </Reveal>

      <div className="auth-divider">
        <span />
        or with email
        <span />
      </div>

      <Reveal show={!firebaseEnabled}>
        <p className="demo-note">
          Demo mode — Firebase isn’t configured, so this account lives only on this device. Add
          VITE_FIREBASE_* keys to go live.
        </p>
      </Reveal>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          run(() => (isSignUp ? signUp(email, password, name) : signIn(email, password)));
        }}
        className="auth-form"
      >
        <Reveal show={isSignUp}>
          <label className="field">
            <span className="label">Name</span>
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ada Lovelace"
              autoComplete="name"
            />
          </label>
        </Reveal>
        <label className="field">
          <span className="label">Email</span>
          <input
            className="input"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@studio.com"
            autoComplete="email"
          />
        </label>
        <label className="field">
          <span className="label">Password</span>
          <input
            className="input"
            type="password"
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            autoComplete={isSignUp ? "new-password" : "current-password"}
          />
        </label>

        <Reveal show={Boolean(error)}>
          <p className="auth-err">{error}</p>
        </Reveal>

        <button type="submit" className="btn primary block" disabled={busy} style={{ marginTop: 4 }}>
          {busy ? "…" : isSignUp ? "Create account" : "Sign in"}
        </button>
      </form>

      <p className="auth-switch">
        {isSignUp ? "Already have an account?" : "New here?"}{" "}
        <button
          type="button"
          className="link"
          onClick={() => setMode(isSignUp ? "sign-in" : "sign-up")}
        >
          {isSignUp ? "Sign in" : "Create one"}
        </button>
      </p>

      <Reveal show={isSignUp}>
        <p className="auth-legal">
          By creating an account, you agree to our{" "}
          <button type="button" className="link" onClick={() => openLegalPage("/terms")}>
            Terms of Use
          </button>{" "}
          and{" "}
          <button type="button" className="link" onClick={() => openLegalPage("/privacy")}>
            Privacy Policy
          </button>
          .
        </p>
      </Reveal>
    </div>
  );
}

function GoogleGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true">
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
