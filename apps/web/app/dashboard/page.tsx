"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";
import { useAuth } from "@/lib/auth";

function DashboardInner() {
  const { user, loading, signOut, setPlan, firebaseEnabled, isPro } = useAuth();
  const router = useRouter();
  const params = useSearchParams();

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
          className="ns-cta ns-cta--sm ns-cta--ghost"
        >
          Sign out
        </button>
      </div>

      {params.get("upgraded") && (
        <div className="ns-banner ns-card mt-6 p-4 font-body text-sm">
          🎉 You own <b>Pro</b> — exports are unlocked for good.{" "}
          {params.get("upgraded") === "mock" && user.demo && (
            <span className="font-mono text-xs text-inksoft">(mock checkout — Stripe not live yet)</span>
          )}
        </div>
      )}

      <div className="ns-card mt-6 p-6">
        <div>
          <span className="ns-chip">Current status</span>
          <h2 className="mt-2 font-display text-2xl">{isPro ? "Pro" : "Free"}</h2>
        </div>

        {isPro && (
          <p className="mt-3 font-body text-sm text-inksoft">
            Thanks for buying Pro — your one-time purchase unlocks all features including future updates.
          </p>
        )}

        <div className="mt-5 flex flex-wrap gap-3">
          {!isPro && (
            <Link href="/pricing" className="ns-cta ns-cta--sm ns-cta--accent">
              Buy Pro · $49
            </Link>
          )}
          {isPro && user.demo && (
            <button
              onClick={() => setPlan("trial")}
              className="ns-cta ns-cta--sm ns-cta--ghost"
            >
              Reset (demo)
            </button>
          )}
          <Link href="/download" className="ns-cta ns-cta--sm ns-cta--primary">
            Download app
          </Link>
        </div>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <InfoCard title="Recordings" body="Captures live in ~/Videos/ninesixteen as encrypted .ns files. Browse and preview them in the desktop app." />
        <InfoCard
          title="Purchase"
          body={
            isPro
              ? "Pro is a one-time purchase — unlocked on this account for good. Receipts are emailed by Stripe."
              : firebaseEnabled
                ? "One-time $49 purchase via Stripe unlocks Pro export forever."
                : "Stripe & Firebase are in placeholder mode for testing."
          }
        />
      </div>

      {user.demo && (
        <p className="ns-banner mt-6 p-3 font-mono text-[11px] text-inksoft">
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
