import { NextResponse } from "next/server";
import {
  isAdminConfigured,
  upsertUserProfileOnSignIn,
  verifyUserIdToken,
} from "@/lib/firebaseAdmin";

export const runtime = "nodejs";

/**
 * Upsert users/{uid} on sign-in so every account has a Firestore profile with
 * plan "trial" (free) or "pro" (paying). Clients call this after Firebase Auth
 * succeeds; the Stripe webhook still owns plan upgrades/downgrades.
 */
export async function POST(req: Request) {
  if (!isAdminConfigured) {
    return NextResponse.json({ ok: true, mock: true, plan: "trial" });
  }

  const header = req.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Missing token" }, { status: 401 });
  }

  const token = header.slice("Bearer ".length);
  const decoded = await verifyUserIdToken(token);
  if (!decoded) {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  let body: { email?: string | null; displayName?: string | null } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    // optional body
  }

  const plan = await upsertUserProfileOnSignIn(decoded.uid, {
    email: body.email ?? decoded.email ?? null,
    displayName: body.displayName ?? decoded.name ?? null,
  });

  return NextResponse.json({ ok: true, plan: plan ?? "trial" });
}
