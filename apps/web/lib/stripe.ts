/**
 * Server-side Stripe helper.
 *
 * Placeholder-friendly: if STRIPE_SECRET_KEY is missing we run in "mock" mode
 * so the whole upgrade flow is clickable end-to-end during testing without a
 * real Stripe account. Drop in keys + price ids to go live.
 *
 * Pricing: $12 / month or $39 / year (two recurring prices in Stripe).
 */
import Stripe from "stripe";

export type BillingInterval = "monthly" | "yearly";

export const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY ?? "";
export const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? "";

export const STRIPE_PRICE_MONTHLY =
  process.env.STRIPE_PRICE_ID_MONTHLY ?? process.env.STRIPE_PRICE_ID ?? "";
export const STRIPE_PRICE_YEARLY = process.env.STRIPE_PRICE_ID_YEARLY ?? "";

export function priceForInterval(interval: BillingInterval): string {
  return interval === "yearly" ? STRIPE_PRICE_YEARLY : STRIPE_PRICE_MONTHLY;
}

export const isStripeConfigured = Boolean(STRIPE_SECRET_KEY && STRIPE_PRICE_MONTHLY);

let stripe: Stripe | null = null;

export function getStripe(): Stripe | null {
  if (!STRIPE_SECRET_KEY) return null;
  if (!stripe) {
    stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2025-02-24.acacia" });
  }
  return stripe;
}
