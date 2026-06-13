import { NextResponse } from "next/server";
import {
  createCustomToken,
  isAdminConfigured,
  upsertUserProfileOnSignIn,
  verifyUserIdToken,
} from "@/lib/firebaseAdmin";
import { markDesktopAuthReady } from "@/lib/desktopAuthSession";

export const runtime = "nodejs";

/** Web browser completes desktop sign-in after the user authenticates here. */
export async function POST(req: Request) {
  if (!isAdminConfigured) {
    return NextResponse.json({ ok: true, mock: true });
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

  if (!code || code.length > 128) {
    return NextResponse.json({ error: "Invalid code" }, { status: 400 });
  }

  await upsertUserProfileOnSignIn(decoded.uid, {
    email: decoded.email ?? null,
    displayName: decoded.name ?? null,
  });
  await markDesktopAuthReady(code, decoded.uid);

  return NextResponse.json({ ok: true });
}
