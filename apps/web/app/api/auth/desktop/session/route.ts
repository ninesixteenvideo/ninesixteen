import { NextResponse } from "next/server";
import { createCustomToken, isAdminConfigured } from "@/lib/firebaseAdmin";
import { consumeDesktopAuthSession } from "@/lib/desktopAuthSession";

export const runtime = "nodejs";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

/** Desktop app polls until the browser sign-in completes, then receives a custom token. */
export async function GET(req: Request) {
  if (req.method === "OPTIONS") {
    return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
  }

  if (!isAdminConfigured) {
    return NextResponse.json(
      { status: "mock" },
      { headers: CORS_HEADERS }
    );
  }

  const code = new URL(req.url).searchParams.get("code")?.trim();
  if (!code) {
    return NextResponse.json(
      { error: "Missing code" },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  const session = await consumeDesktopAuthSession(code);
  if (!session) {
    return NextResponse.json({ status: "pending" }, { headers: CORS_HEADERS });
  }

  const customToken = await createCustomToken(session.uid);
  if (!customToken) {
    return NextResponse.json(
      { error: "Could not create sign-in token" },
      { status: 500, headers: CORS_HEADERS }
    );
  }

  return NextResponse.json(
    { status: "ready", customToken },
    { headers: CORS_HEADERS }
  );
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
