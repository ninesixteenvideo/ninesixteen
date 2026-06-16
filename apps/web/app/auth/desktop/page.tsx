"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Wordmark } from "@ninesixteen/brand/Wordmark";
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
    <div className="mx-auto max-w-md px-5 py-16 text-center">
      <Wordmark size={36} showSuffix />
      <h1 className="mt-6 font-display text-2xl">Sign in for desktop</h1>
      <p className="mt-3 font-body text-sm text-inksoft">
        Complete sign-in here to link your account to the ninesixteen desktop app.
      </p>

      {/* Step 1 — sign in (if not already). */}
      {code && !user && !loading && (
        <div className="mt-8 text-left">
          <AuthForm mode="sign-in" onAuthenticated={() => {}} />
        </div>
      )}

      {loading && (
        <p className="mt-8 font-mono text-xs text-inksoft">Loading…</p>
      )}

      {/* Step 2 — confirm the code shown in the desktop app. */}
      {code && user && status !== "done" && (
        <form onSubmit={approve} className="mt-8 text-left">
          <label className="block font-body text-sm">
            <span className="text-inksoft">
              Enter the code shown in your ninesixteen desktop app
            </span>
            <input
              value={verifier}
              onChange={(e) => setVerifier(e.target.value.toUpperCase())}
              placeholder="ABC123"
              autoFocus
              autoComplete="off"
              spellCheck={false}
              maxLength={12}
              className="ns-input mt-2 text-center font-mono text-lg tracking-[0.3em]"
            />
          </label>
          <p className="mt-3 font-body text-xs text-inksoft">
            Only enter a code that your own ninesixteen desktop app is showing.
            Never enter a code that someone sent you — doing so could give them
            access to your account.
          </p>
          <button
            type="submit"
            disabled={!canSubmit || status === "linking"}
            className="ns-cta ns-cta--primary mt-5 w-full disabled:opacity-50"
          >
            {status === "linking" ? "Linking…" : "Link desktop app"}
          </button>
        </form>
      )}

      {status === "done" && (
        <div className="ns-banner ns-card mt-8 p-5 font-body text-sm">
          You&rsquo;re signed in. Return to the ninesixteen desktop app.
        </div>
      )}

      {error && (
        <div className="ns-banner ns-card mt-8 border-danger/30 p-5 font-body text-sm text-inksoft">
          {error}
        </div>
      )}
    </div>
  );
}

export default function DesktopAuthPage() {
  return (
    <Suspense fallback={<div className="py-24 text-center font-mono text-inksoft">Loading…</div>}>
      <DesktopAuthInner />
    </Suspense>
  );
}
