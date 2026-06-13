"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { EmbeddedCheckoutForm } from "@/components/EmbeddedCheckoutForm";
import { useAuth } from "@/lib/auth";
import { getFirebaseAuth } from "@/lib/firebase";
import type { BillingInterval } from "@/lib/stripe";

const PLAN_LABELS: Record<BillingInterval, string> = {
  monthly: "Pro · $12 / month",
  yearly: "Pro · $39 / year",
};

function CheckoutInner() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const interval: BillingInterval = params.get("interval") === "yearly" ? "yearly" : "monthly";

  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [initializing, setInitializing] = useState(true);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace(`/sign-in?next=/checkout&interval=${interval}`);
    }
  }, [loading, user, router, interval]);

  useEffect(() => {
    if (loading || !user) return;

    let cancelled = false;
    setInitializing(true);
    setError(null);
    setClientSecret(null);

    (async () => {
      try {
        const auth = getFirebaseAuth();
        if (!auth?.currentUser?.emailVerified) {
          if (!cancelled) {
            setError("Verify your email address before subscribing. Check your inbox for the Firebase verification link.");
          }
          return;
        }
        const token = auth?.currentUser
          ? await auth.currentUser.getIdToken()
          : null;
        if (!token) {
          if (!cancelled) setError("Sign in required.");
          return;
        }

        const res = await fetch("/api/stripe/checkout", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            email: user.email,
            interval,
          }),
        });
        const data = await res.json();
        if (cancelled) return;

        if (data.mock && data.url) {
          window.location.href = data.url;
          return;
        }
        if (data.clientSecret) {
          setClientSecret(data.clientSecret);
          return;
        }
        setError(data.error ?? "Could not start checkout.");
      } catch {
        if (!cancelled) setError("Could not reach checkout.");
      } finally {
        if (!cancelled) setInitializing(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loading, user, interval]);

  if (loading || !user) {
    return (
      <div className="mx-auto max-w-2xl px-5 py-24 text-center font-mono text-inksoft">
        Loading…
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-5 py-12">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <span className="ns-chip">Checkout</span>
          <h1 className="mt-3 font-display text-3xl tracking-tight">Subscribe to Pro</h1>
          <p className="mt-1 font-body text-sm text-inksoft">{PLAN_LABELS[interval]}</p>
        </div>
        <Link href="/pricing" className="font-mono text-xs text-bluedeep hover:underline">
          ← Back to pricing
        </Link>
      </div>

      {error && (
        <div className="ns-card mb-6 border-danger bg-danger/10 p-4 font-mono text-sm text-danger">
          {error}
        </div>
      )}

      {initializing && !error && (
        <div className="ns-card p-8 text-center font-mono text-sm text-inksoft">
          Preparing secure checkout…
        </div>
      )}

      {clientSecret && !error && (
        <div className="ns-card overflow-hidden p-0">
          <EmbeddedCheckoutForm clientSecret={clientSecret} />
        </div>
      )}

      <p className="mt-6 text-center font-mono text-[11px] text-inkfaint">
        Payments secured by Stripe · Signed in as {user.email}
      </p>
    </div>
  );
}

export default function CheckoutPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-2xl px-5 py-24 text-center font-mono text-inksoft">
          Loading…
        </div>
      }
    >
      <CheckoutInner />
    </Suspense>
  );
}
