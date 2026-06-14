import { NextResponse } from "next/server";
import { isAdminConfigured } from "@/lib/firebaseAdmin";
import { consumeDriveAuthSession } from "@/lib/driveAuthSession";
import { corsHeaders, optionsResponse, withCors } from "@/lib/cors";
import { clientIp, rateLimit } from "@/lib/rateLimit";
import { productionConfigRequired } from "@/lib/serverEnv";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const headers = corsHeaders(req);

  const blocked = productionConfigRequired("Firebase Admin");
  if (blocked) return withCors(req, blocked);

  if (!isAdminConfigured) {
    return NextResponse.json({ status: "mock" }, { headers });
  }

  const ip = clientIp(req);
  if (!rateLimit(`drive-session:${ip}`, 120, 60_000)) {
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

  if (!rateLimit(`drive-session:${code}`, 60, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429, headers });
  }

  const session = await consumeDriveAuthSession(code, secret);
  if (!session) {
    return NextResponse.json({ status: "pending" }, { headers });
  }

  return NextResponse.json(
    {
      status: "ready",
      accessToken: session.accessToken,
      expiresIn: session.expiresIn,
    },
    { headers }
  );
}

export async function OPTIONS(req: Request) {
  return optionsResponse(req);
}
