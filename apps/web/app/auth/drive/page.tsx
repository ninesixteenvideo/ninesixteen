"use client";

import { Suspense, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { Wordmark } from "@ninesixteen/brand/Wordmark";

function DriveAuthInner() {
  const params = useSearchParams();
  const code = params.get("code")?.trim() ?? "";

  useEffect(() => {
    if (!code) return;
    const clientId = process.env.NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID;
    if (!clientId) return;

    const redirectUri = `${window.location.origin}/auth/drive/callback`;
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "token");
    url.searchParams.set(
      "scope",
      "https://www.googleapis.com/auth/drive.file"
    );
    url.searchParams.set("state", code);
    url.searchParams.set("prompt", "consent");
    url.searchParams.set("include_granted_scopes", "true");
    window.location.replace(url.toString());
  }, [code]);

  if (!code) {
    return (
      <p className="font-body text-sm text-inksoft">
        Missing connection code. Return to the desktop app and try again.
      </p>
    );
  }

  if (!process.env.NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID) {
    return (
      <p className="font-body text-sm text-inksoft">
        Google Drive export is not configured on the server yet.
      </p>
    );
  }

  return (
    <p className="font-mono text-xs text-inksoft">
      Redirecting to Google to connect Drive…
    </p>
  );
}

export default function DriveAuthPage() {
  return (
    <div className="mx-auto max-w-md px-5 py-16 text-center">
      <Wordmark size={36} showSuffix />
      <h1 className="mt-6 font-display text-2xl">Connect Google Drive</h1>
      <p className="mt-3 font-body text-sm text-inksoft">
        Authorize ninesixteen to save exports to your Google Drive.
      </p>
      <div className="mt-8">
        <Suspense fallback={<p className="font-mono text-xs text-inksoft">Loading…</p>}>
          <DriveAuthInner />
        </Suspense>
      </div>
    </div>
  );
}
