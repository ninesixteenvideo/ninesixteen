"use client";

import { Suspense, useEffect, useState } from "react";
import { Wordmark } from "@ninesixteen/brand/Wordmark";

function DriveCallbackInner() {
  const [message, setMessage] = useState("Finishing Google Drive connection…");
  const [done, setDone] = useState(false);

  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const accessToken = hash.get("access_token");
    const expiresIn = Number(hash.get("expires_in") ?? "3600");
    const state = hash.get("state") ?? "";
    const error = hash.get("error");

    if (error) {
      setMessage(`Google Drive authorization failed: ${error}`);
      return;
    }

    if (!accessToken || !state) {
      setMessage("Missing authorization data. Close this tab and try again from the desktop app.");
      return;
    }

    (async () => {
      try {
        const res = await fetch("/api/auth/drive/complete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            code: state,
            accessToken,
            expiresIn,
          }),
        });
        if (!res.ok) {
          const data = (await res.json()) as { error?: string };
          throw new Error(data.error ?? "Could not complete Drive connection");
        }
        setDone(true);
        setMessage("Google Drive connected. Return to the ninesixteen desktop app.");
      } catch (e) {
        setMessage(e instanceof Error ? e.message : "Something went wrong.");
      }
    })();
  }, []);

  return (
    <div
      className={`ns-card mt-8 p-5 font-body text-sm ${done ? "bg-mint/40" : "bg-yellow/30"}`}
    >
      {message}
    </div>
  );
}

export default function DriveCallbackPage() {
  return (
    <div className="mx-auto max-w-md px-5 py-16 text-center">
      <Wordmark size={36} showSuffix />
      <h1 className="mt-6 font-display text-2xl">Google Drive</h1>
      <Suspense fallback={<p className="mt-8 font-mono text-xs text-inksoft">Loading…</p>}>
        <DriveCallbackInner />
      </Suspense>
    </div>
  );
}
