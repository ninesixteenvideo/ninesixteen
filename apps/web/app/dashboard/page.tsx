"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";
import { useAuth } from "@/lib/auth";

function DashboardInner() {
  const {
    user,
    loading,
    signOut,
    setPlan,
    firebaseEnabled,
    isPro,
    subscriptionCancelled,
    proEndsAt,
    formatProEndDate,
    openBillingPortal,
  } = useAuth();
  const router = useRouter();
  const params = useSearchParams();

  // On return from mock checkout (dev only): upgrade demo users optimistically.
  useEffect(() => {
    if (
      params.get("upgraded") === "mock" &&
      user &&
      user.demo &&
      user.plan !== "pro"
    ) {
      setPlan("pro");
    }
  }, [params, user, setPlan]);

  useEffect(() => {
    if (!loading && !user) router.replace("/sign-in");
  }, [loading, user, router]);

  if (loading || !user) {
    return (
      <div className="mx-auto max-w-3xl px-5 py-24 text-center font-mono text-inksoft">
        Loading…
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-5 py-14">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl">
            Hey, {user.displayName || user.email.split("@")[0]} 👋
          </h1>
          <p className="font-mono text-xs text-inksoft">{user.email}</p>
        </div>
        <button
          onClick={() => signOut()}
          className="rounded-full border-2 border-ink bg-surface px-4 py-2 font-display text-sm shadow-[3px_3px_0_var(--color-ink)] transition-transform hover:-translate-y-0.5"
        >
          Sign out
        </button>
      </div>

      {params.get("upgraded") && (
        <div className="ns-card mt-6 bg-mint/40 p-4 font-body text-sm">
          🎉 You’re on <b>Pro</b>{" "}
          {params.get("upgraded") === "mock" && user.demo && (
            <span className="font-mono text-xs text-inksoft">(mock checkout — Stripe not live yet)</span>
          )}
        </div>
      )}

      {subscriptionCancelled && proEndsAt && (
        <div className="ns-card mt-6 border-2 border-ink bg-yellow/30 p-4 font-body text-sm">
          Subscription cancelled — Pro access continues until{" "}
          <b>{formatProEndDate(proEndsAt)}</b>.
        </div>
      )}

      <div className="ns-card mt-6 p-6">
        <div className="flex items-center justify-between">
          <div>
            <span className="ns-chip">Current plan</span>
            <h2 className="mt-2 font-display text-2xl">{isPro ? "Pro" : "Free"}</h2>
          </div>
          <span
            className="rounded-full border-2 border-ink px-4 py-1.5 font-display"
            style={{ background: isPro ? "var(--color-pink)" : "var(--color-blue)" }}
          >
            {isPro ? "Pro" : "$0"}
          </span>
        </div>

        <div className="mt-5 flex flex-wrap gap-3">
          {isPro ? (
            <button
              onClick={() => {
                if (user.demo) setPlan("trial");
                else void openBillingPortal();
              }}
              className="rounded-full border-2 border-ink bg-surface px-5 py-2.5 font-display shadow-[3px_3px_0_var(--color-ink)] transition-transform hover:-translate-y-0.5"
            >
              Manage / cancel
            </button>
          ) : (
            <Link
              href="/pricing"
              className="rounded-full border-2 border-ink bg-pink px-5 py-2.5 font-display shadow-[3px_3px_0_var(--color-ink)] transition-transform hover:-translate-y-0.5"
            >
              Upgrade to Pro
            </Link>
          )}
          <Link
            href="/download"
            className="rounded-full border-2 border-ink bg-blue px-5 py-2.5 font-display shadow-[3px_3px_0_var(--color-ink)] transition-transform hover:-translate-y-0.5"
          >
            Download app
          </Link>
        </div>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <InfoCard title="Recordings" body="Captures live in ~/Videos/ninesixteen as encrypted .ns files. Browse and preview them in the desktop app." />
        <InfoCard
          title="Billing"
          body={
            subscriptionCancelled && proEndsAt
              ? `Subscription cancelled. Pro ends on ${formatProEndDate(proEndsAt)}.`
              : firebaseEnabled
                ? "Subscription managed via Stripe."
                : "Stripe & Firebase are in placeholder mode for testing."
          }
        />
      </div>

      {user.demo && (
        <p className="mt-6 rounded-lg border-2 border-ink bg-yellow/50 p-3 font-mono text-[11px] text-ink">
          Demo session stored locally in this browser. Configure Firebase to persist real accounts.
        </p>
      )}
    </div>
  );
}

function InfoCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="ns-card p-5">
      <h3 className="font-display text-lg">{title}</h3>
      <p className="mt-1 font-body text-sm text-inksoft">{body}</p>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <Suspense fallback={null}>
      <DashboardInner />
    </Suspense>
  );
}
