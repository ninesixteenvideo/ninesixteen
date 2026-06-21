"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { WordmarkTv } from "@/components/WordmarkTv";
import { AuthForm } from "@/components/AuthForm";
import { useAuth } from "@/lib/auth";

function DesktopAuthInner() {
  const params = useSearchParams();
  const code = params.get("code")?.trim() ?? "";
  const { user, loading } = useAuth();
  const [verifier, setVerifier] = useState("");
  const [status, setStatus] = useState<"idle" | "linking" | "done">("idle");
  const [error, setError] = useState<string | null>(
    code ? null : "Missing sign-in code. Return to the desktop app and try again."
  );

  const canSubmit =
    Boolean(code) && Boolean(user?.uid) && verifier.trim().length >= 4;

  async function approve(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || status === "linking") return;
    setError(null);
    setStatus("linking");
    try {
      const auth = (await import("@/lib/firebase")).getFirebaseAuth();
      if (!auth?.currentUser) throw new Error("Not signed in");
      const token = await auth.currentUser.getIdToken();
      const res = await fetch("/api/auth/desktop/complete", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ code, verifier: verifier.trim() }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "Could not link desktop app");
      }
      setStatus("done");
    } catch (err) {
      setStatus("idle");
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  return (
    <div className="home-auth home-auth--page">
      <div className="mb-8 flex justify-center">
        <WordmarkTv size={36} showSuffix wrapClassName="ns-wm-tv--nav" />
      </div>

      <div className="home-auth__console">
        <p className="home-auth__kicker">Desktop link</p>
        <h1 className="home-auth__heading">Sign in for desktop</h1>
        <p className="home-auth__lede">
          Complete sign-in here to link your account to the ninesixteen desktop app.
        </p>

        {!code && error ? <p className="home-auth__error">{error}</p> : null}

        {code && !user && !loading ? (
          <div className="home-panel__auth">
            <AuthForm mode="sign-in" embedded onAuthenticated={() => {}} />
          </div>
        ) : null}

        {loading ? <p className="home-auth__meta">Loading…</p> : null}

        {code && user && status !== "done" ? (
          <form onSubmit={approve} className="home-auth__form home-auth__form--spaced">
            <label className="home-auth__field">
              <span className="home-auth__label">Desktop code</span>
              <input
                value={verifier}
                onChange={(e) => setVerifier(e.target.value.toUpperCase())}
                placeholder="ABC123"
                autoFocus
                autoComplete="off"
                spellCheck={false}
                maxLength={12}
                className="home-auth__input home-auth__input--code"
              />
            </label>
            <p className="home-auth__hint">
              Only enter a code that your own ninesixteen desktop app is showing. Never enter a
              code that someone sent you — doing so could give them access to your account.
            </p>
            {error ? <p className="home-auth__error">{error}</p> : null}
            <button
              type="submit"
              disabled={!canSubmit || status === "linking"}
              className="home-auth__action home-auth__action--mint"
            >
              <span className="home-auth__action-eyebrow">Desktop link</span>
              <span className="home-auth__action-title">
                {status === "linking" ? "Linking…" : "Link desktop app"}
              </span>
              <span className="home-auth__action-meta">Confirm the code above</span>
            </button>
          </form>
        ) : null}

        {status === "done" ? (
          <div className="home-auth__notice home-auth__notice--success">
            You&apos;re signed in. Return to the ninesixteen desktop app.
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default function DesktopAuthPage() {
  return (
    <Suspense
      fallback={
        <div className="home-auth home-auth--page">
          <p className="home-auth__meta">Loading…</p>
        </div>
      }
    >
      <DesktopAuthInner />
    </Suspense>
  );
}
