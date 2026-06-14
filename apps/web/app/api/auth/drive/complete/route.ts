import { NextResponse } from "next/server";
import { isAdminConfigured } from "@/lib/firebaseAdmin";
import { markDriveAuthReady } from "@/lib/driveAuthSession";
import { exchangeGoogleAuthCode, isGoogleDriveOAuthConfigured } from "@/lib/googleOAuthServer";
import { driveRedirectUri } from "@/lib/googlePkce";
import { clientIp, rateLimit } from "@/lib/rateLimit";
import { productionConfigRequired } from "@/lib/serverEnv";

export const runtime = "nodejs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(req: Request) {
  const blocked = productionConfigRequired("Firebase Admin", isAdminConfigured);
  if (blocked) return blocked;

  if (!isAdminConfigured) {
    return NextResponse.json({ ok: true, mock: true });
  }

  const oauthBlocked = productionConfigRequired(
    "Google OAuth",
    isGoogleDriveOAuthConfigured()
  );
  if (oauthBlocked) return oauthBlocked;

  const ip = clientIp(req);
  if (!rateLimit(`drive-complete:${ip}`, 30, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  let body: {
    code?: string;
    secret?: string;
    googleCode?: string;
    codeVerifier?: string;
    redirectUri?: string;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const code = body.code?.trim() ?? "";
  const secret = body.secret?.trim() ?? "";
  const googleCode = body.googleCode?.trim() ?? "";
  const codeVerifier = body.codeVerifier?.trim() ?? "";
  if (!UUID_RE.test(code) || !secret || !googleCode || !codeVerifier) {
    return NextResponse.json({ error: "Missing handoff or OAuth parameters" }, { status: 400 });
  }

  const origin = req.headers.get("origin") ?? "https://ninesixteen.video";
  const redirectUri = body.redirectUri?.trim() || driveRedirectUri(origin);

  let accessToken: string;
  let expiresIn: number;
  try {
    ({ accessToken, expiresIn } = await exchangeGoogleAuthCode({
      code: googleCode,
      codeVerifier,
      redirectUri,
    }));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Google token exchange failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const ok = await markDriveAuthReady(code, secret, accessToken, expiresIn);
  if (!ok) {
    return NextResponse.json(
      { error: "Invalid or expired Drive handoff" },
      { status: 400 }
    );
  }

  return NextResponse.json({ ok: true });
}
