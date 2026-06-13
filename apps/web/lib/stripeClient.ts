"use client";

import { loadStripe, type Stripe } from "@stripe/stripe-js";

const key = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "";

let stripePromise: Promise<Stripe | null> | null = null;

export function getStripePromise(): Promise<Stripe | null> | null {
  if (!key) return null;
  if (!stripePromise) {
    stripePromise = loadStripe(key);
  }
  return stripePromise;
}

export const isStripeClientConfigured = Boolean(key);
