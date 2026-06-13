import type Stripe from "stripe";
import type { EntitlementUpdate } from "./firebaseAdmin";

/** Map a Stripe subscription to Firestore entitlement fields. */
export function entitlementFromStripeSubscription(
  sub: Stripe.Subscription
): EntitlementUpdate {
  const periodEndMs = sub.current_period_end * 1000;
  const active = sub.status === "active" || sub.status === "trialing";

  if (active && sub.cancel_at_period_end) {
    return {
      plan: "pro",
      proEndsAt: periodEndMs,
      subscriptionCancelAtPeriodEnd: true,
      stripeSubscriptionId: sub.id,
      subscriptionStatus: sub.status,
    };
  }

  if (active) {
    return {
      plan: "pro",
      proEndsAt: null,
      subscriptionCancelAtPeriodEnd: false,
      stripeSubscriptionId: sub.id,
      subscriptionStatus: sub.status,
    };
  }

  // Still within a paid period after cancel (edge cases before deletion event).
  if (periodEndMs > Date.now()) {
    return {
      plan: "pro",
      proEndsAt: periodEndMs,
      subscriptionCancelAtPeriodEnd: true,
      stripeSubscriptionId: sub.id,
      subscriptionStatus: sub.status,
    };
  }

  return {
    plan: "trial",
    proEndsAt: null,
    subscriptionCancelAtPeriodEnd: false,
    stripeSubscriptionId: sub.id,
    subscriptionStatus: sub.status,
  };
}
