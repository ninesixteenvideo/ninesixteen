"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Wordmark } from "@ninesixteen/brand/Wordmark";
import { AuthForm } from "@/components/AuthForm";
import { useAuth } from "@/lib/auth";

function DesktopAuthInner() {
  const params = useSearchParams();
  const code = params.get("code")?.trim() ?? "";
  const { user, loading } = useAuth();
  const [status, setStatus] = useState<"waiting" | "linking" | "done" | "error">(
    code ? "waiting" : "error"
  );
  const [message, setMessage] = useState(
    code ? "" : "Missing sign-in code. Return to the desktop app and try again."
  );

  useEffect(() => {
    if (!code || loading || !user) return;

    let cancelled = false;
    (async () => {
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
          body: JSON.stringify({ code }),
        });
        if (!res.ok) {
          const data = (await res.json()) as { error?: string };
          throw new Error(data.error ?? "Could not link desktop app");
        }
        if (!cancelled) {
          setStatus("done");
          setMessage("You're signed in. Return to the ninesixteen desktop app.");
        }
      } catch (e) {
        if (!cancelled) {
          setStatus("error");
          setMessage(e instanceof Error ? e.message : "Something went wrong.");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [code, user, loading]);

  return (
    <div className="mx-auto max-w-md px-5 py-16 text-center">
      <Wordmark size={36} showSuffix />
      <h1 className="mt-6 font-display text-2xl">Sign in for desktop</h1>
      <p className="mt-3 font-body text-sm text-inksoft">
        Complete sign-in here to link your account to the ninesixteen desktop app.
      </p>

      {status === "waiting" && !user && !loading && (
        <div className="mt-8 text-left">
          <AuthForm mode="sign-in" onAuthenticated={() => {}} />
        </div>
      )}

      {(loading || status === "waiting") && !user && (
        <p className="mt-8 font-mono text-xs text-inksoft">Loading…</p>
      )}

      {user && status !== "done" && status !== "error" && (
        <p className="mt-8 font-mono text-xs text-inksoft">Linking desktop app…</p>
      )}

      {status === "done" && (
        <div className="ns-card mt-8 bg-mint/40 p-5 font-body text-sm">{message}</div>
      )}

      {status === "error" && (
        <div className="ns-card mt-8 bg-yellow/40 p-5 font-body text-sm">{message}</div>
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
