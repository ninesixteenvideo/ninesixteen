import { NextResponse } from "next/server";
import {
  isAdminConfigured,
  upsertUserProfileOnSignIn,
  verifyUserIdToken,
} from "@/lib/firebaseAdmin";
import { markDesktopAuthReady } from "@/lib/desktopAuthSession";
import { clientIp, rateLimit } from "@/lib/rateLimit";
import { productionConfigRequired } from "@/lib/serverEnv";

export const runtime = "nodejs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Web browser completes desktop sign-in after the user authenticates here. */
export async function POST(req: Request) {
  const blocked = productionConfigRequired("Firebase Admin", isAdminConfigured);
  if (blocked) return blocked;

  if (!isAdminConfigured) {
    return NextResponse.json({ ok: true, mock: true });
  }

  const ip = clientIp(req);
  let body: { code?: string; verifier?: string } = {};
  try {
    body = (await req.json()) as { code?: string; verifier?: string };
  } catch {
    return NextResponse.json({ error: "Missing code" }, { status: 400 });
  }

  const code = (body.code ?? "").trim();
  if (!UUID_RE.test(code)) {
    return NextResponse.json({ error: "Invalid code" }, { status: 400 });
  }

  const verifier = (body.verifier ?? "").trim().toUpperCase();
  if (!/^[A-Z0-9]{4,12}$/.test(verifier)) {
    return NextResponse.json(
      { error: "Enter the code shown in your desktop app." },
      { status: 400 }
    );
  }

  // Per-handoff code limit — duplicate browser retries should not burn the IP bucket.
  if (!rateLimit(`desktop-complete:${code}`, 8, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }
  if (!rateLimit(`desktop-complete:${ip}`, 60, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const header = req.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Missing token" }, { status: 401 });
  }

  const decoded = await verifyUserIdToken(header.slice("Bearer ".length));
  if (!decoded) {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  await upsertUserProfileOnSignIn(decoded.uid, {
    email: decoded.email ?? null,
    displayName: decoded.name ?? null,
  });

  const linked = await markDesktopAuthReady(code, decoded.uid, verifier);
  if (!linked) {
    return NextResponse.json(
      { error: "That code didn't match, or the request expired. Check the code in your desktop app and try again." },
      { status: 400 }
    );
  }

  return NextResponse.json({ ok: true });
}
