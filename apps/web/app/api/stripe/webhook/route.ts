import { NextResponse } from "next/server";
import type Stripe from "stripe";
import {
  getStripe,
  isStripeConfigured,
  STRIPE_PRICE_ID,
  STRIPE_WEBHOOK_SECRET,
} from "@/lib/stripe";
import { setUserEntitlement } from "@/lib/firebaseAdmin";
import { productionConfigRequired } from "@/lib/serverEnv";

export const runtime = "nodejs";

/**
 * Stripe webhook receiver — writes the lifetime Pro entitlement to Firestore.
 *
 * Pro is a one-time purchase: a completed checkout grants Pro permanently.
 */
export async function POST(req: Request) {
  const blocked = productionConfigRequired(
    "Stripe webhook",
    isStripeConfigured && Boolean(STRIPE_WEBHOOK_SECRET)
  );
  if (blocked) return blocked;

  const stripe = getStripe();
  if (!stripe || !STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json({ received: true, mock: true });
  }

  const sig = req.headers.get("stripe-signature");
  if (!sig) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  const raw = await req.text();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(raw, sig, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid signature";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const uid = session.client_reference_id ?? session.metadata?.uid;
        if (!uid) break;

        // Only grant Pro on a fully paid one-time checkout (not subscription/setup).
        if (session.mode !== "payment") break;
        if (session.payment_status !== "paid") break;

        // Reject $0 sessions (e.g. a 100%-off promo code or a manually created
        // zero-amount session) — Pro must be an actual purchase.
        if ((session.amount_total ?? 0) <= 0) break;

        // Verify the purchase was for *our* Pro price. The line items are not in
        // the webhook payload, so fetch them and confirm the configured price id
        // is present — this stops a spoofed/cheaper checkout from granting Pro.
        if (!STRIPE_PRICE_ID) break;
        let priceMatches = false;
        try {
          const lineItems = await stripe.checkout.sessions.listLineItems(
            session.id,
            { limit: 100 }
          );
          priceMatches = lineItems.data.some(
            (item) => item.price?.id === STRIPE_PRICE_ID
          );
        } catch {
          priceMatches = false;
        }
        if (!priceMatches) break;

        const customerId =
          typeof session.customer === "string" ? session.customer : undefined;
        const paymentIntentId =
          typeof session.payment_intent === "string"
            ? session.payment_intent
            : undefined;

        await setUserEntitlement(uid, {
          plan: "pro",
          stripeCustomerId: customerId,
          stripePaymentIntentId: paymentIntentId,
        });
        break;
      }

      default:
        break;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Webhook handler error";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
