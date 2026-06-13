import { NextResponse } from "next/server";
import {
  isAdminConfigured,
  upsertUserProfileOnSignIn,
} from "@/lib/firebaseAdmin";
import { requireBearerUser } from "@/lib/requireAuth";
import { productionConfigRequired } from "@/lib/serverEnv";
import { clientIp, rateLimit } from "@/lib/rateLimit";

export const runtime = "nodejs";

/**
 * Upsert users/{uid} on sign-in so every account has a Firestore profile with
 * plan "trial" (free) or "pro" (paying). Clients call this after Firebase Auth
 * succeeds; the Stripe webhook still owns plan upgrades/downgrades.
 */
export async function POST(req: Request) {
  const blocked = productionConfigRequired("Firebase Admin");
  if (blocked) return blocked;

  const ip = clientIp(req);
  if (!rateLimit(`users-sync:${ip}`, 60, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  if (!isAdminConfigured) {
    return NextResponse.json({ ok: true, mock: true, plan: "trial" });
  }

  const decoded = await requireBearerUser(req);
  if (!decoded) {
    return NextResponse.json({ error: "Missing token" }, { status: 401 });
  }

  let body: { email?: string | null; displayName?: string | null } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    // optional body
  }

  try {
    const plan = await upsertUserProfileOnSignIn(decoded.uid, {
      email: body.email ?? decoded.email ?? null,
      displayName: body.displayName ?? decoded.name ?? null,
    });
    return NextResponse.json({ ok: true, plan: plan ?? "trial" });
  } catch (err) {
    console.error("[users/sync]", err);
    const message = err instanceof Error ? err.message : "Sync failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
