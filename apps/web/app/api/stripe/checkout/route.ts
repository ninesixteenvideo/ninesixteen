import { NextResponse } from "next/server";
import { getStripe, isStripeConfigured, STRIPE_PRICE_ID } from "@/lib/stripe";
import { requireBearerUser } from "@/lib/requireAuth";
import { isProduction, productionConfigRequired } from "@/lib/serverEnv";

export const runtime = "nodejs";

/**
 * Creates an embedded Stripe Checkout session for the one-time Pro purchase ($49).
 *
 * Requires a Firebase ID token — the authenticated uid is stamped onto the
 * session so the webhook can write the lifetime entitlement to Firestore.
 */
export async function POST(req: Request) {
  const user = await requireBearerUser(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!user.emailVerified) {
    return NextResponse.json(
      { error: "Verify your email address before purchasing Pro." },
      { status: 403 }
    );
  }

  if (!isStripeConfigured) {
    if (isProduction()) {
      return (
        productionConfigRequired("Stripe", isStripeConfigured) ??
        NextResponse.json({ error: "Stripe not configured" }, { status: 503 })
      );
    }
    const origin = req.headers.get("origin") ?? "http://localhost:3000";
    return NextResponse.json({
      mock: true,
      url: `${origin}/dashboard?upgraded=mock`,
    });
  }

  const stripe = getStripe();
  if (!stripe) {
    return NextResponse.json({ error: "Stripe not initialised" }, { status: 500 });
  }

  const origin = req.headers.get("origin") ?? "http://localhost:3000";
  let email: string | undefined = user.email ?? undefined;
  try {
    const body = await req.json();
    if (body?.email) email = body.email;
  } catch {
    /* no body is fine */
  }

  const uid = user.uid;
  if (!STRIPE_PRICE_ID) {
    return NextResponse.json(
      { error: "No Stripe price configured" },
      { status: 500 }
    );
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      ui_mode: "embedded",
      payment_method_types: ["card"],
      line_items: [{ price: STRIPE_PRICE_ID, quantity: 1 }],
      customer_email: email,
      client_reference_id: uid,
      payment_intent_data: { metadata: { uid } },
      metadata: { uid },
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
