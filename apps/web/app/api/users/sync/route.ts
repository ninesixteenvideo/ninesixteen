import { NextResponse } from "next/server";
import {
  isAdminConfigured,
  upsertUserProfileOnSignIn,
} from "@/lib/firebaseAdmin";
import { jsonWithCors, optionsResponse, withCors } from "@/lib/cors";
import { requireBearerUser } from "@/lib/requireAuth";
import { productionConfigRequired } from "@/lib/serverEnv";
import { clientIp, rateLimit } from "@/lib/rateLimit";

export const runtime = "nodejs";

export async function OPTIONS(req: Request) {
  return optionsResponse(req);
}

/**
 * Upsert users/{uid} on sign-in so every account has a Firestore profile with
 * plan "trial" (free) or "pro" (paying). Clients call this after Firebase Auth
 * succeeds; the Stripe webhook still owns plan upgrades/downgrades.
 */
export async function POST(req: Request) {
  const blocked = productionConfigRequired("Firebase Admin", isAdminConfigured);
  if (blocked) return withCors(req, blocked);

  const ip = clientIp(req);
  if (!rateLimit(`users-sync:${ip}`, 60, 60_000)) {
    return jsonWithCors(req, { error: "Too many requests" }, { status: 429 });
  }

  if (!isAdminConfigured) {
    return jsonWithCors(req, { ok: true, mock: true, plan: "trial" });
  }

  const decoded = await requireBearerUser(req);
  if (!decoded) {
    return jsonWithCors(req, { error: "Missing token" }, { status: 401 });
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
    return jsonWithCors(req, { ok: true, plan: plan ?? "trial" });
  } catch (err) {
    console.error("[users/sync]", err);
    const message = err instanceof Error ? err.message : "Sync failed";
    return jsonWithCors(req, { error: message }, { status: 500 });
  }
}
