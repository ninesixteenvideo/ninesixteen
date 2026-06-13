import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripe, STRIPE_WEBHOOK_SECRET } from "@/lib/stripe";
import { setUserEntitlement } from "@/lib/firebaseAdmin";
import { entitlementFromStripeSubscription } from "@/lib/stripeEntitlement";
import { productionConfigRequired } from "@/lib/serverEnv";

export const runtime = "nodejs";

/**
 * Stripe webhook receiver — writes Pro entitlements to Firestore.
 *
 * Active subscriptions stay Pro. Cancelled subscriptions keep Pro until
 * current_period_end (proEndsAt), then revert to trial on deletion.
 */
export async function POST(req: Request) {
  const blocked = productionConfigRequired("Stripe webhook");
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

        const customerId =
          typeof session.customer === "string" ? session.customer : undefined;
        const subId =
          typeof session.subscription === "string" ? session.subscription : undefined;

        if (subId) {
          const sub = await stripe.subscriptions.retrieve(subId);
          await setUserEntitlement(uid, {
            ...entitlementFromStripeSubscription(sub),
            stripeCustomerId: customerId,
          });
        } else {
          await setUserEntitlement(uid, {
            plan: "pro",
            proEndsAt: null,
            subscriptionCancelAtPeriodEnd: false,
            stripeCustomerId: customerId,
            subscriptionStatus: "active",
          });
        }
        break;
      }

      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const uid = sub.metadata?.uid;
        if (uid) {
          await setUserEntitlement(uid, entitlementFromStripeSubscription(sub));
        }
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
