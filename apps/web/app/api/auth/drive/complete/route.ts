import { NextResponse } from "next/server";
import { isAdminConfigured } from "@/lib/firebaseAdmin";
import { markDriveAuthReady } from "@/lib/driveAuthSession";

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!isAdminConfigured) {
    return NextResponse.json({ ok: true, mock: true });
  }

  let body: {
    code?: string;
    accessToken?: string;
    expiresIn?: number;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const code = body.code?.trim();
  const accessToken = body.accessToken?.trim();
  if (!code || !accessToken) {
    return NextResponse.json({ error: "Missing code or token" }, { status: 400 });
  }

  await markDriveAuthReady(code, accessToken, body.expiresIn ?? 3600);
  return NextResponse.json({ ok: true });
}
