"use client";

import { Suspense, useEffect, useState } from "react";
import { Wordmark } from "@ninesixteen/brand/Wordmark";
import { driveRedirectUri } from "@/lib/googlePkce";

const PKCE_PREFIX = "ns-drive-pkce-";
const HANDOFF_PREFIX = "ns-drive-handoff-";

function DriveCallbackInner() {
  const [message, setMessage] = useState("Finishing Google Drive connection…");
  const [done, setDone] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const googleCode = params.get("code");
    const state = params.get("state") ?? "";
    const error = params.get("error");

    if (error) {
      setMessage(`Google Drive authorization failed: ${error}`);
      return;
    }

    if (!googleCode || !state) {
      setMessage("Missing authorization data. Close this tab and try again from the desktop app.");
      return;
    }

    const secret = sessionStorage.getItem(`${HANDOFF_PREFIX}${state}`);
    const codeVerifier = sessionStorage.getItem(`${PKCE_PREFIX}${state}`);
    sessionStorage.removeItem(`${HANDOFF_PREFIX}${state}`);
    sessionStorage.removeItem(`${PKCE_PREFIX}${state}`);

    if (!secret || !codeVerifier) {
      setMessage("Missing secure handoff. Close this tab and try again from the desktop app.");
      return;
    }

    void (async () => {
      try {
        const res = await fetch("/api/auth/drive/complete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            code: state,
            secret,
            googleCode,
            codeVerifier,
            redirectUri: driveRedirectUri(window.location.origin),
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
    <div className="ns-banner ns-card mt-8 p-5 font-body text-sm text-inksoft">
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
