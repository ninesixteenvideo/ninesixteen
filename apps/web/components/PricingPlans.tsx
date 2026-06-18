"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";

const FEATURES = [
  "All features, present and future",
  "Save locally or straight to Google Drive",
  "Up to 1080p · 60fps encoding",
  "Account links to desktop app",
  "Free updates, forever",
  "Priority support from the developer",
];

export function PricingPlans() {
  const { user, isPro } = useAuth();
  const router = useRouter();

  function startCheckout() {
    if (!user) {
      router.push("/sign-up?next=/checkout");
      return;
    }
    router.push("/checkout");
  }

  return (
    <div className="mx-auto mt-8 max-w-md">
      <div className="ns-card relative flex flex-col p-7">
        <span className="absolute -top-3 right-6 ns-chip bg-surfacehi text-ink">
          One-time
        </span>
        <h3 className="font-display text-2xl">Pro · Full version</h3>
        <p className="mt-1 font-body text-sm text-inksoft">
          Pay once, own it for good. Unlock unlimited MP4 export across desktop and web —
          no subscription, ever.
        </p>
        <div className="mt-4 flex items-end gap-1">
          <span className="font-display text-5xl">$49</span>
          <span className="mb-1.5 font-mono text-sm text-inksoft">USD · one-time</span>
        </div>
        <p className="mt-1 font-mono text-xs text-inksoft">
          Lifetime license · pay once, no recurring fees
        </p>

        <ul className="mt-5 space-y-2">
          {FEATURES.map((f) => (
            <li key={f} className="flex items-start gap-2 font-body text-sm text-inksoft">
              <span className="mt-0.5 font-display text-ink">✓</span>
              {f}
            </li>
          ))}
        </ul>

        {isPro ? (
          <Link href="/dashboard" className="ns-cta ns-cta--primary mt-7 w-full text-center">
            You own Pro — open dashboard
          </Link>
        ) : (
          <button
            onClick={startCheckout}
            className="ns-cta ns-cta--accent mt-7 w-full"
          >
            {user ? "Buy Pro · $49" : "Sign up to buy"}
          </button>
        )}
      </div>

      <p className="mx-auto mt-10 max-w-xl text-center font-body text-sm text-inksoft">
        Want to try first?{" "}
        <Link href="/download" className="ns-link">
          Download the free trial
        </Link>{" "}
        — record and preview everything at no cost. Exporting to MP4 is the only thing Pro
        unlocks.
      </p>
    </div>
  );
}
