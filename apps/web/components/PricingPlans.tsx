"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAuth } from "@/lib/auth";

type Interval = "monthly" | "yearly";

const PRO_PRICE: Record<Interval, { price: string; cadence: string; note: string }> = {
  monthly: { price: "$12", cadence: "/ month", note: "billed monthly" },
  yearly: { price: "$39", cadence: "/ year", note: "billed yearly · save 73%" },
};

const FREE_FEATURES = [
  "16×9 & 9×16 capture",
  "Two-handed framing viewport",
  "Local-first recording",
  "Unlimited recording length",
  "Preview & playback in-app",
];

const PRO_FEATURES = [
  "Everything in Free",
  "Export & save your videos",
  "No watermark",
  "4K / 60fps encoding",
  "Priority builds & support",
];

export function PricingPlans() {
  const { user } = useAuth();
  const router = useRouter();
  const [interval, setInterval] = useState<Interval>("yearly");
  const [busy, setBusy] = useState<string | null>(null);

  async function startCheckout() {
    if (!user) {
      router.push("/sign-up");
      return;
    }
    setBusy("pro");
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

  const pro = PRO_PRICE[interval];

  return (
    <div className="mt-12">
      <div className="flex justify-center">
        <div className="inline-flex rounded-full border-2 border-ink bg-surface p-1 shadow-[3px_3px_0_var(--color-ink)]">
          {(["monthly", "yearly"] as const).map((opt) => (
            <button
              key={opt}
              onClick={() => setInterval(opt)}
              className="rounded-full px-5 py-2 font-display text-sm transition-colors"
              style={
                interval === opt
                  ? { background: "var(--color-ink)", color: "var(--color-bg)" }
                  : undefined
              }
            >
              {opt === "monthly" ? "Monthly" : "Yearly"}
              {opt === "yearly" && (
                <span
                  className="ml-2 rounded-full px-2 py-0.5 font-mono text-[10px]"
                  style={
                    interval === "yearly"
                      ? { background: "var(--color-mint)", color: "var(--color-ink)" }
                      : { background: "var(--color-mint)", color: "var(--color-ink)" }
                  }
                >
                  -73%
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-8 grid gap-6 md:grid-cols-2">
        {/* Free */}
        <div className="ns-card relative flex flex-col p-7">
          <h3 className="font-display text-2xl">Free</h3>
          <div className="mt-3 flex items-end gap-1">
            <span className="font-display text-5xl">$0</span>
            <span className="mb-1.5 font-mono text-sm text-inksoft">forever</span>
          </div>
          <ul className="mt-6 flex-1 space-y-3">
            {FREE_FEATURES.map((f) => (
              <li key={f} className="flex items-start gap-2 font-body text-sm">
                <Check accent="blue" />
                <span>{f}</span>
              </li>
            ))}
          </ul>
          <button
            onClick={() => router.push("/download")}
            className="mt-7 rounded-full border-2 border-ink bg-blue px-5 py-3 font-display text-lg shadow-[4px_4px_0_var(--color-ink)] transition-transform hover:-translate-y-0.5"
          >
            Download free
          </button>
        </div>

        {/* Pro */}
        <div
          className="ns-card relative flex flex-col p-7"
          style={{ boxShadow: "7px 7px 0 var(--color-pinkdeep)" }}
        >
          <span className="absolute -top-3 right-6 rounded-full border-2 border-ink bg-yellow px-3 py-0.5 font-display text-xs">
            Most popular
          </span>
          <h3 className="font-display text-2xl">Pro</h3>
          <div className="mt-3 flex items-end gap-1">
            <span className="font-display text-5xl">{pro.price}</span>
            <span className="mb-1.5 font-mono text-sm text-inksoft">{pro.cadence}</span>
          </div>
          <p className="mt-1 font-mono text-xs text-inksoft">{pro.note}</p>
          <ul className="mt-6 flex-1 space-y-3">
            {PRO_FEATURES.map((f) => (
              <li key={f} className="flex items-start gap-2 font-body text-sm">
                <Check accent="pink" />
                <span>{f}</span>
              </li>
            ))}
          </ul>
          <button
            onClick={startCheckout}
            disabled={busy === "pro"}
            className="mt-7 rounded-full border-2 border-ink bg-pink px-5 py-3 font-display text-lg shadow-[4px_4px_0_var(--color-ink)] transition-transform hover:-translate-y-0.5 disabled:opacity-60"
          >
            {busy === "pro" ? "…" : user ? "Upgrade to Pro" : "Sign up to subscribe"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Check({ accent }: { accent: "pink" | "blue" }) {
  return (
    <span
      className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 border-ink"
      style={{ background: accent === "pink" ? "var(--color-pink)" : "var(--color-blue)" }}
    >
      ✓
    </span>
  );
}
