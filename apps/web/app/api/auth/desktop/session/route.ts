import { NextResponse } from "next/server";
import { createCustomToken, isAdminConfigured } from "@/lib/firebaseAdmin";
import { consumeDesktopAuthSession } from "@/lib/desktopAuthSession";
import { corsHeaders, optionsResponse, withCors } from "@/lib/cors";
import { clientIp, rateLimit } from "@/lib/rateLimit";
import { productionConfigRequired } from "@/lib/serverEnv";

export const runtime = "nodejs";

/** Desktop app polls until the browser sign-in completes, then receives a custom token. */
export async function GET(req: Request) {
  const headers = corsHeaders(req);

  if (req.method === "OPTIONS") {
    return new NextResponse(null, { status: 204, headers });
  }

  const blocked = productionConfigRequired("Firebase Admin", isAdminConfigured);
  if (blocked) return withCors(req, blocked);

  if (!isAdminConfigured) {
    return NextResponse.json({ status: "mock" }, { headers });
  }

  const ip = clientIp(req);
  if (!rateLimit(`desktop-session:${ip}`, 120, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429, headers });
  }

  const url = new URL(req.url);
  const code = url.searchParams.get("code")?.trim();
  const secret = url.searchParams.get("secret")?.trim();
  if (!code || !secret) {
    return NextResponse.json(
      { error: "Missing code or secret" },
      { status: 400, headers }
    );
  }

  if (!rateLimit(`desktop-session:${code}`, 60, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429, headers });
  }

  const session = await consumeDesktopAuthSession(code, secret);
  if (!session) {
    return NextResponse.json({ status: "pending" }, { headers });
  }

  const customToken = await createCustomToken(session.uid);
  if (!customToken) {
    return NextResponse.json(
      { error: "Could not create sign-in token" },
      { status: 500, headers }
    );
  }

  return NextResponse.json({ status: "ready", customToken }, { headers });
}

export async function OPTIONS(req: Request) {
  return optionsResponse(req);
}
