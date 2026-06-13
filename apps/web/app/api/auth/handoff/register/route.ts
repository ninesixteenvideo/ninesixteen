import { NextResponse } from "next/server";
import { isAdminConfigured } from "@/lib/firebaseAdmin";
import { registerDesktopAuthHandoff } from "@/lib/desktopAuthSession";
import { registerDriveAuthHandoff } from "@/lib/driveAuthSession";
import { clientIp, rateLimit } from "@/lib/rateLimit";
import { productionConfigRequired } from "@/lib/serverEnv";

export const runtime = "nodejs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Desktop app registers a one-time handoff code + secret before opening the browser. */
export async function POST(req: Request) {
  const blocked = productionConfigRequired("Firebase Admin");
  if (blocked) return blocked;

  if (!isAdminConfigured) {
    return NextResponse.json({ ok: true, mock: true });
  }

  const ip = clientIp(req);
  if (!rateLimit(`handoff-register:${ip}`, 30, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  let body: { code?: string; secret?: string; kind?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const code = body.code?.trim() ?? "";
  const secret = body.secret?.trim() ?? "";
  const kind = body.kind?.trim();

  if (!UUID_RE.test(code) || secret.length < 16 || secret.length > 256) {
    return NextResponse.json({ error: "Invalid handoff parameters" }, { status: 400 });
  }

  const ok =
    kind === "desktop"
      ? await registerDesktopAuthHandoff(code, secret)
      : kind === "drive"
        ? await registerDriveAuthHandoff(code, secret)
        : false;

  if (!ok) {
    return NextResponse.json({ error: "Could not register handoff" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
