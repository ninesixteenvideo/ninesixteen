import { NextResponse } from "next/server";
import { getAdminDb, verifyUserIdToken } from "@/lib/firebaseAdmin";
import { getStripe, isStripeConfigured } from "@/lib/stripe";

export const runtime = "nodejs";

/** Open Stripe Customer Portal so the user can manage or cancel their subscription. */
export async function POST(req: Request) {
  if (!isStripeConfigured) {
    return NextResponse.json({ mock: true, url: "/dashboard" });
  }

  const stripe = getStripe();
  if (!stripe) {
    return NextResponse.json({ error: "Stripe not initialised" }, { status: 500 });
  }

  const header = req.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Missing token" }, { status: 401 });
  }

  const decoded = await verifyUserIdToken(header.slice("Bearer ".length));
  if (!decoded) {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  const db = getAdminDb();
  if (!db) {
    return NextResponse.json({ error: "Billing unavailable" }, { status: 503 });
  }

  const userDoc = await db.collection("users").doc(decoded.uid).get();
  const customerId = userDoc.data()?.stripeCustomerId as string | undefined;
  if (!customerId) {
    return NextResponse.json({ error: "No billing account found" }, { status: 404 });
  }

  const origin = req.headers.get("origin") ?? "https://ninesixteen.video";
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${origin}/dashboard`,
  });

  return NextResponse.json({ url: session.url });
}
