import { NextResponse } from "next/server";
import {
  getStripe,
  isStripeConfigured,
  priceForInterval,
  type BillingInterval,
} from "@/lib/stripe";

export const runtime = "nodejs";

/**
 * Creates an embedded Stripe Checkout session for the Pro plan ($12/mo or $39/yr).
 *
 * Returns a `clientSecret` for Embedded Checkout on /checkout. The caller passes
 * the Firebase `uid` so we can stamp it onto the session (`client_reference_id`)
 * and the resulting subscription (`metadata.uid`). The webhook then writes the
 * entitlement to Firestore keyed by that uid — which is the same account the
 * desktop app reads, so a web purchase unlocks export on the desktop instantly.
 *
 * In mock mode (no keys) it returns a local URL that simulates a successful
 * upgrade so the flow is testable today.
 */
export async function POST(req: Request) {
  const origin = req.headers.get("origin") ?? "http://localhost:3000";
  let email: string | undefined;
  let uid: string | undefined;
  let interval: BillingInterval = "monthly";
  try {
    const body = await req.json();
    email = body?.email;
    uid = body?.uid;
    if (body?.interval === "yearly") interval = "yearly";
  } catch {
    /* no body is fine */
  }

  if (!isStripeConfigured) {
    // Placeholder: pretend checkout succeeded and bounce to the dashboard.
    return NextResponse.json({
      mock: true,
      url: `${origin}/dashboard?upgraded=mock`,
    });
  }

  const stripe = getStripe();
  if (!stripe) {
    return NextResponse.json({ error: "Stripe not initialised" }, { status: 500 });
  }

  const price = priceForInterval(interval);
  if (!price) {
    return NextResponse.json(
      { error: `No Stripe price configured for ${interval}` },
      { status: 500 }
    );
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      ui_mode: "embedded",
      payment_method_types: ["card"],
      line_items: [{ price, quantity: 1 }],
      customer_email: email,
      client_reference_id: uid,
      subscription_data: uid ? { metadata: { uid } } : undefined,
      metadata: uid ? { uid } : undefined,
      return_url: `${origin}/dashboard?upgraded=1&session_id={CHECKOUT_SESSION_ID}`,
      allow_promotion_codes: true,
    });

    if (!session.client_secret) {
      return NextResponse.json({ error: "Checkout session missing client secret" }, { status: 500 });
    }

    return NextResponse.json({ clientSecret: session.client_secret });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Checkout failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
