"use client";

import { EmbeddedCheckout, EmbeddedCheckoutProvider } from "@stripe/react-stripe-js";
import { getStripePromise } from "@/lib/stripeClient";

export function EmbeddedCheckoutForm({ clientSecret }: { clientSecret: string }) {
  const stripePromise = getStripePromise();
  if (!stripePromise) {
    return (
      <p className="font-mono text-sm text-danger">
        Stripe publishable key missing — add NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY.
      </p>
    );
  }

  return (
    <EmbeddedCheckoutProvider stripe={stripePromise} options={{ clientSecret }}>
      <EmbeddedCheckout className="stripe-embedded-checkout" />
    </EmbeddedCheckoutProvider>
  );
}
