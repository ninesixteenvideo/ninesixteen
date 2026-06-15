"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Wordmark } from "@ninesixteen/brand/Wordmark";
import { useAuth } from "@/lib/auth";

function AuthFormInner({
  mode,
  onAuthenticated,
}: {
  mode: "sign-in" | "sign-up";
  onAuthenticated?: () => void;
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

  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-5 py-16">
      <Link href="/" aria-label="Home">
        <Wordmark size={34} showSuffix />
      </Link>
      <div className="ns-card mt-8 w-full p-7">
        <h1 className="font-display text-2xl">
          {isSignUp ? "Create your account" : "Welcome back"}
        </h1>
        <p className="mt-1 font-body text-sm text-inksoft">
          {isSignUp
            ? "Create an account to sync Pro across desktop and web."
            : "Sign in to manage your account and export entitlements."}
        </p>

        {!firebaseEnabled && (
          <div className="mt-4 rounded-lg border-2 border-ink bg-yellow/60 p-3 font-mono text-[11px] leading-relaxed text-onbright">
            Demo mode: Firebase isn’t configured yet, so accounts are stored locally
            in this browser. Add your keys to <code>.env.local</code> to go live.
          </div>
        )}

        <button
          type="button"
          onClick={onGoogle}
          disabled={busy}
          className="mt-5 flex w-full items-center justify-center gap-3 rounded-full border-2 border-ink bg-white px-5 py-3 font-display text-base text-black shadow-[4px_4px_0_var(--color-shadow)] transition-transform hover:-translate-y-0.5 disabled:opacity-60"
        >
          <GoogleGlyph />
          Continue with Google
        </button>

        <div className="my-5 flex items-center gap-3 font-mono text-[11px] uppercase tracking-wide text-inksoft">
          <span className="h-px flex-1 bg-ink/20" />
          or with email
          <span className="h-px flex-1 bg-ink/20" />
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          {isSignUp && (
            <Field label="Name">
              <input
                className="ns-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ada Lovelace"
                autoComplete="name"
              />
            </Field>
          )}
          <Field label="Email">
            <input
              className="ns-input"
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
              className="ns-input"
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete={isSignUp ? "new-password" : "current-password"}
            />
          </Field>

          {error && (
            <p className="rounded-lg border-2 border-danger bg-danger/10 px-3 py-2 font-mono text-xs text-danger">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-full border-2 border-ink bg-blue px-5 py-3 font-display text-lg shadow-[4px_4px_0_var(--color-shadow)] transition-transform hover:-translate-y-0.5 disabled:opacity-60"
          >
            {busy ? "…" : isSignUp ? "Create account" : "Sign in"}
          </button>
        </form>

        {isSignUp && (
          <p className="mt-5 text-center font-body text-sm text-inksoft">
            By creating an account, you agree to our{" "}
            <Link href="/terms" className="font-semibold text-bluedeep hover:underline">
              Terms of Use
            </Link>{" "}
            and{" "}
            <Link href="/privacy" className="font-semibold text-bluedeep hover:underline">
              Privacy Policy
            </Link>
            .
          </p>
        )}

        <p className={`text-center font-body text-sm text-inksoft ${isSignUp ? "mt-3" : "mt-5"}`}>
          {isSignUp ? (
            <>
              Already have an account?{" "}
              <Link href="/sign-in" className="font-semibold text-bluedeep hover:underline">
                Sign in
              </Link>
            </>
          ) : (
            <>
              New here?{" "}
              <Link href="/sign-up" className="font-semibold text-pinkdeep hover:underline">
                Create an account
              </Link>
            </>
          )}
        </p>
      </div>

      <style>{`
        .ns-input {
          width: 100%;
          border: 2px solid var(--color-ink);
          border-radius: 12px;
          background: var(--color-bg);
          padding: 0.7rem 0.9rem;
          font-family: var(--ns-font-body);
          font-size: 0.95rem;
          outline: none;
        }
        .ns-input:focus { box-shadow: 3px 3px 0 var(--color-shadow); }
      `}</style>
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
    <label className="block">
      <span className="mb-1.5 block font-mono text-xs uppercase tracking-wide text-inksoft">
        {label}
      </span>
      {children}
    </label>
  );
}

export function AuthForm({
  mode,
  onAuthenticated,
}: {
  mode: "sign-in" | "sign-up";
  onAuthenticated?: () => void;
}) {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-md px-5 py-24 text-center font-mono text-inksoft">
          Loading…
        </div>
      }
    >
      <AuthFormInner mode={mode} onAuthenticated={onAuthenticated} />
    </Suspense>
  );
}
