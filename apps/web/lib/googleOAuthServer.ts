const TOKEN_URL = "https://oauth2.googleapis.com/token";

function clientId(): string | null {
  return (process.env.NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID ?? "").trim() || null;
}

function clientSecret(): string | null {
  return (process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? "").trim() || null;
}

export function isGoogleDriveOAuthConfigured(): boolean {
  return Boolean(clientId() && clientSecret());
}

/** Exchange an authorization code (PKCE) for a short-lived Google access token. */
export async function exchangeGoogleAuthCode(params: {
  code: string;
  codeVerifier: string;
  redirectUri: string;
}): Promise<{ accessToken: string; expiresIn: number }> {
  const id = clientId();
  const secret = clientSecret();
  if (!id || !secret) {
    throw new Error("Google OAuth is not configured on the server");
  }

  const body = new URLSearchParams({
    code: params.code,
    client_id: id,
    client_secret: secret,
    redirect_uri: params.redirectUri,
    grant_type: "authorization_code",
    code_verifier: params.codeVerifier,
  });

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const data = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };

  if (!res.ok || !data.access_token) {
    const detail = data.error_description ?? data.error ?? "Token exchange failed";
    throw new Error(detail);
  }

  return {
    accessToken: data.access_token,
    expiresIn: typeof data.expires_in === "number" ? data.expires_in : 3600,
  };
}
