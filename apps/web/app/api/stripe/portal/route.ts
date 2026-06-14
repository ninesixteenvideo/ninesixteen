import { NextResponse } from "next/server";
import { getAdminDb, verifyUserIdToken } from "@/lib/firebaseAdmin";
import { jsonWithCors, optionsResponse, withCors } from "@/lib/cors";
import { getStripe, isStripeConfigured } from "@/lib/stripe";
import { isProduction, productionConfigRequired } from "@/lib/serverEnv";

export const runtime = "nodejs";

/** Open Stripe Customer Portal so the user can manage or cancel their subscription. */
export async function OPTIONS(req: Request) {
  return optionsResponse(req);
}

export async function POST(req: Request) {
  if (!isStripeConfigured) {
    if (isProduction()) {
      const blocked =
        productionConfigRequired("Stripe") ??
        NextResponse.json({ error: "Stripe not configured" }, { status: 503 });
      return withCors(req, blocked);
    }
    return jsonWithCors(req, { mock: true, url: "/dashboard" });
  }

  const stripe = getStripe();
  if (!stripe) {
    return jsonWithCors(req, { error: "Stripe not initialised" }, { status: 500 });
  }

  const header = req.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) {
    return jsonWithCors(req, { error: "Missing token" }, { status: 401 });
  }

  const decoded = await verifyUserIdToken(header.slice("Bearer ".length));
  if (!decoded) {
    return jsonWithCors(req, { error: "Invalid token" }, { status: 401 });
  }

  const db = getAdminDb();
  if (!db) {
    return jsonWithCors(req, { error: "Billing unavailable" }, { status: 503 });
  }

  const userDoc = await db.collection("users").doc(decoded.uid).get();
  const customerId = userDoc.data()?.stripeCustomerId as string | undefined;
  if (!customerId) {
    return jsonWithCors(req, { error: "No billing account found" }, { status: 404 });
  }

  const origin = req.headers.get("origin") ?? "https://ninesixteen.video";
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${origin}/dashboard`,
  });

  return jsonWithCors(req, { url: session.url });
}
