/**
 * Server-side Stripe helper.
 *
 * Placeholder-friendly: if STRIPE_SECRET_KEY is missing we run in "mock" mode
 * so the whole upgrade flow is clickable end-to-end during testing without a
 * real Stripe account. Drop in keys + the price id to go live.
 *
 * Pricing: a single one-time purchase of $49 (one Stripe "one off" price).
 */
import Stripe from "stripe";

export const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY ?? "";
export const STRIPE_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "";
export const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? "";

/** One-time price id for the $49 full version. */
export const STRIPE_PRICE_ID = process.env.STRIPE_PRICE_ID ?? "";

export const isStripeConfigured = Boolean(
  STRIPE_SECRET_KEY && STRIPE_PUBLISHABLE_KEY && STRIPE_PRICE_ID
);

let stripe: Stripe | null = null;

export function getStripe(): Stripe | null {
  if (!STRIPE_SECRET_KEY) return null;
  if (!stripe) {
    stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2025-02-24.acacia" });
  }
  return stripe;
}
