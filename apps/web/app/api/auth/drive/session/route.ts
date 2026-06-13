import { NextResponse } from "next/server";
import { isAdminConfigured } from "@/lib/firebaseAdmin";
import { consumeDriveAuthSession } from "@/lib/driveAuthSession";

export const runtime = "nodejs";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function GET(req: Request) {
  if (!isAdminConfigured) {
    return NextResponse.json({ status: "mock" }, { headers: CORS_HEADERS });
  }

  const code = new URL(req.url).searchParams.get("code")?.trim();
  if (!code) {
    return NextResponse.json(
      { error: "Missing code" },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  const session = await consumeDriveAuthSession(code);
  if (!session) {
    return NextResponse.json({ status: "pending" }, { headers: CORS_HEADERS });
  }

  return NextResponse.json(
    {
      status: "ready",
      accessToken: session.accessToken,
      expiresIn: session.expiresIn,
    },
    { headers: CORS_HEADERS }
  );
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
