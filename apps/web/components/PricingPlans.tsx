"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAuth } from "@/lib/auth";

type Interval = "monthly" | "yearly";

const PLANS: Record<
  Interval,
  { title: string; price: string; cadence: string; note: string; badge?: string; featured?: boolean }
> = {
  monthly: {
    title: "Pro · Monthly",
    price: "$12",
    cadence: "/ month",
    note: "Billed monthly · cancel anytime",
  },
  yearly: {
    title: "Pro · Yearly",
    price: "$39",
    cadence: "/ year",
    note: "Billed yearly · save 73%",
    badge: "Best value",
    featured: true,
  },
};

export function PricingPlans() {
  const { user } = useAuth();
  const router = useRouter();
  const [busy, setBusy] = useState<Interval | null>(null);

  async function startCheckout(interval: Interval) {
    if (!user) {
      router.push(`/sign-up?plan=${interval}`);
      return;
    }
    setBusy(interval);
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: user.email, uid: user.uid, interval }),
      });
      const data = await res.json();
      if (data.url) window.location.href = data.url;
      else setBusy(null);
    } catch {
      setBusy(null);
    }
  }

  return (
    <div className="mt-12">
      <div className="grid gap-6 md:grid-cols-2">
        {(["monthly", "yearly"] as const).map((interval) => {
          const plan = PLANS[interval];
          return (
            <div
              key={interval}
              className="ns-card relative flex flex-col p-7"
              style={
                plan.featured ? { boxShadow: "7px 7px 0 var(--color-pinkdeep)" } : undefined
              }
            >
              {plan.badge && (
                <span className="absolute -top-3 right-6 rounded-full border-2 border-ink bg-yellow px-3 py-0.5 font-display text-xs">
                  {plan.badge}
                </span>
              )}
              <h3 className="font-display text-2xl">{plan.title}</h3>
              <p className="mt-1 font-body text-sm text-inksoft">
                Full app plus decrypted MP4 export. One subscription, desktop and web.
              </p>
              <div className="mt-4 flex items-end gap-1">
                <span className="font-display text-5xl">{plan.price}</span>
                <span className="mb-1.5 font-mono text-sm text-inksoft">{plan.cadence}</span>
              </div>
              <p className="mt-1 font-mono text-xs text-inksoft">{plan.note}</p>
              <button
                onClick={() => startCheckout(interval)}
                disabled={busy === interval}
                className={`ns-cta mt-auto pt-8 w-full disabled:opacity-60 ${plan.featured ? "ns-cta--accent" : "ns-cta--primary"}`}
              >
                {busy === interval
                  ? "…"
                  : user
                    ? `Subscribe ${interval === "yearly" ? "yearly" : "monthly"}`
                    : "Sign up to subscribe"}
              </button>
            </div>
          );
        })}
      </div>

      <p className="mx-auto mt-10 max-w-xl text-center font-body text-sm text-inksoft">
        Not ready to subscribe?{" "}
        <Link href="/download" className="font-semibold text-bluedeep hover:underline">
          Free download
        </Link>{" "}
        — install the app and try everything except export. Record, preview, and stream with
        the virtual camera at no cost.
      </p>
    </div>
  );
}
