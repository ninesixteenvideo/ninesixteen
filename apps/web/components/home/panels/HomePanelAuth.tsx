"use client";

import Link from "next/link";
import { Suspense, useState } from "react";
import { AuthForm } from "@/components/AuthForm";
import { useAuth } from "@/lib/auth";
import { HomeBackControl } from "../HomeBackControl";
import type { HomeView } from "../homeViews";

type HomePanelAuthProps = {
  mode: "sign-in" | "sign-up";
  onBack: () => void;
  onSwitchMode: (mode: "sign-in" | "sign-up") => void;
  onAuthenticated: (next: HomeView) => void;
  pendingCheckout?: boolean;
};

function HomePanelAuthInner({
  mode,
  onBack,
  onSwitchMode,
  onAuthenticated,
  pendingCheckout,
}: HomePanelAuthProps) {
  const { user, loading, signOut } = useAuth();

  if (!loading && user) {
    return (
      <section className="home-panel home-panel--auth" aria-label="Account">
        <HomeBackControl onBack={onBack} />
        <p className="home-panel__kicker">Signed in</p>
        <h2 className="home-panel__heading">{user.email}</h2>
        <p className="home-panel__lede">
          {user.plan === "pro" ? "Pro license active on this account." : "Free tier — export unlocks with Pro."}
        </p>
        <div className="home-panel__actions">
          <Link href="/dashboard" className="home-panel__btn home-panel__btn--mint">
            Open dashboard
          </Link>
          <button
            type="button"
            className="home-panel__btn home-panel__btn--muted"
            onClick={() => {
              void signOut().then(() => onBack());
            }}
          >
            Sign out
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="home-panel home-panel--auth" aria-label={mode === "sign-in" ? "Sign in" : "Create account"}>
      <HomeBackControl onBack={onBack} />
      <p className="home-panel__kicker">{mode === "sign-in" ? "Welcome back" : "New account"}</p>
      {pendingCheckout ? (
        <p className="home-panel__lede home-panel__lede--tight">
          Sign in or create an account to complete your $49 purchase.
        </p>
      ) : null}

      <div className="home-panel__auth">
        <div className="home-auth__console">
          <AuthForm
            mode={mode}
            embedded
            onSwitchMode={onSwitchMode}
            onAuthenticated={() => onAuthenticated(pendingCheckout ? "checkout" : "hero")}
          />
        </div>
      </div>
    </section>
  );
}

export function HomePanelAuth(props: HomePanelAuthProps) {
  return (
    <Suspense fallback={<section className="home-panel home-panel--loading" aria-hidden />}>
      <HomePanelAuthInner {...props} />
    </Suspense>
  );
}
