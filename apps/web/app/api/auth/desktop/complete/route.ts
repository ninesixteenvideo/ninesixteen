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
  const blocked = productionConfigRequired("Firebase Admin");
  if (blocked) return blocked;

  if (!isAdminConfigured) {
    return NextResponse.json({ ok: true, mock: true });
  }

  const ip = clientIp(req);
  if (!rateLimit(`desktop-complete:${ip}`, 30, 60_000)) {
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

  let code = "";
  try {
    const body = (await req.json()) as { code?: string };
    code = (body.code ?? "").trim();
  } catch {
    return NextResponse.json({ error: "Missing code" }, { status: 400 });
  }

  if (!UUID_RE.test(code)) {
    return NextResponse.json({ error: "Invalid code" }, { status: 400 });
  }

  await upsertUserProfileOnSignIn(decoded.uid, {
    email: decoded.email ?? null,
    displayName: decoded.name ?? null,
  });

  const linked = await markDesktopAuthReady(code, decoded.uid);
  if (!linked) {
    return NextResponse.json(
      { error: "Invalid or expired desktop handoff" },
      { status: 400 }
    );
  }

  return NextResponse.json({ ok: true });
}
