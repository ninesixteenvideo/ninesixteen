import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripe, STRIPE_WEBHOOK_SECRET } from "@/lib/stripe";
import { setUserEntitlement } from "@/lib/firebaseAdmin";

export const runtime = "nodejs";

/**
 * Stripe webhook receiver — the only writer of Pro entitlements.
 *
 * Flips a user's Firestore plan to "pro" on a completed checkout / active
 * subscription, and back to "trial" when the subscription ends. The uid is
 * resolved from `client_reference_id` (checkout) or `subscription.metadata.uid`.
 *
 * Requires STRIPE_WEBHOOK_SECRET + Firebase Admin creds to persist. Without
 * them it verifies/logs only (mock mode).
 */
export async function POST(req: Request) {
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
        if (uid) {
          await setUserEntitlement(uid, {
            plan: "pro",
            stripeCustomerId:
              typeof session.customer === "string" ? session.customer : undefined,
            stripeSubscriptionId:
              typeof session.subscription === "string"
                ? session.subscription
                : undefined,
            subscriptionStatus: "active",
          });
        }
        break;
      }

      case "customer.subscription.updated": {
        const sub = event.data.object as Stripe.Subscription;
        const uid = sub.metadata?.uid;
        if (uid) {
          const active = sub.status === "active" || sub.status === "trialing";
          await setUserEntitlement(uid, {
            plan: active ? "pro" : "trial",
            stripeSubscriptionId: sub.id,
            subscriptionStatus: sub.status,
          });
        }
        break;
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const uid = sub.metadata?.uid;
        if (uid) {
          await setUserEntitlement(uid, {
            plan: "trial",
            stripeSubscriptionId: sub.id,
            subscriptionStatus: sub.status,
          });
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
