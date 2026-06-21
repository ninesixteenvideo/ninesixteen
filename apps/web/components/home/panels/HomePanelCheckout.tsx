"use client";

import { useEffect, useState } from "react";
import { EmbeddedCheckoutForm } from "@/components/EmbeddedCheckoutForm";
import { useAuth } from "@/lib/auth";
import { getFirebaseAuth } from "@/lib/firebase";
import { HomeBackControl } from "../HomeBackControl";

type HomePanelCheckoutProps = {
  onBack: () => void;
  onSignIn: () => void;
};

export function HomePanelCheckout({ onBack, onSignIn }: HomePanelCheckoutProps) {
  const { user, loading } = useAuth();
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [initializing, setInitializing] = useState(true);

  useEffect(() => {
    if (loading) return;
    if (!user) onSignIn();
  }, [loading, user, onSignIn]);

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
            setError(
              "Verify your email before purchasing. Check your inbox for the verification link."
            );
          }
          return;
        }
        const token = auth?.currentUser ? await auth.currentUser.getIdToken() : null;
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
          body: JSON.stringify({ email: user.email }),
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
  }, [loading, user]);

  if (loading || !user) {
    return (
      <section className="home-panel home-panel--loading" aria-label="Checkout">
        <p className="home-panel__meta">Preparing checkout…</p>
      </section>
    );
  }

  return (
    <section className="home-panel home-panel--wide" aria-label="Checkout">
      <HomeBackControl onBack={onBack} label="Pricing" />
      <p className="home-panel__kicker">Secure checkout</p>
      <h2 className="home-panel__heading">Buy Pro · $49</h2>

      {error ? (
        <div className="home-panel__error">{error}</div>
      ) : null}

      {initializing && !error ? (
        <p className="home-panel__meta">Preparing secure checkout…</p>
      ) : null}

      {clientSecret && !error ? (
        <div className="home-panel__checkout">
          <EmbeddedCheckoutForm clientSecret={clientSecret} />
        </div>
      ) : null}

      <p className="home-panel__foot">Payments secured by Stripe · {user.email}</p>
    </section>
  );
}
