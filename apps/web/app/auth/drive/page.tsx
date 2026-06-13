"use client";

import { Suspense, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { Wordmark } from "@ninesixteen/brand/Wordmark";
import {
  driveRedirectUri,
  DRIVE_OAUTH_SCOPE,
  generateCodeChallenge,
  generateCodeVerifier,
} from "@/lib/googlePkce";

const PKCE_PREFIX = "ns-drive-pkce-";
const HANDOFF_PREFIX = "ns-drive-handoff-";

function DriveAuthInner() {
  const params = useSearchParams();
  const code = params.get("code")?.trim() ?? "";
  const handoff = params.get("handoff")?.trim() ?? "";

  useEffect(() => {
    if (code && handoff) {
      sessionStorage.setItem(`${HANDOFF_PREFIX}${code}`, handoff);
    }
  }, [code, handoff]);

  useEffect(() => {
    if (!code) return;
    const clientId = process.env.NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID;
    if (!clientId) return;

    void (async () => {
      const verifier = generateCodeVerifier();
      sessionStorage.setItem(`${PKCE_PREFIX}${code}`, verifier);
      const challenge = await generateCodeChallenge(verifier);

      const redirectUri = driveRedirectUri(window.location.origin);
      const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      url.searchParams.set("client_id", clientId);
      url.searchParams.set("redirect_uri", redirectUri);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("scope", DRIVE_OAUTH_SCOPE);
      url.searchParams.set("state", code);
      url.searchParams.set("code_challenge", challenge);
      url.searchParams.set("code_challenge_method", "S256");
      url.searchParams.set("prompt", "consent");
      url.searchParams.set("include_granted_scopes", "true");
      url.searchParams.set("access_type", "online");
      window.location.replace(url.toString());
    })();
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
