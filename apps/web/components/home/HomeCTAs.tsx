"use client";

import { useAuth } from "@/lib/auth";
import type { HomeView } from "./homeViews";

type HomeCTAsProps = {
  onNavigate: (view: HomeView) => void;
  disabled?: boolean;
};

/** Broadcast control deck — triggers in-page glitch transitions. */
export function HomeCTAs({ onNavigate, disabled }: HomeCTAsProps) {
  const { user, loading } = useAuth();
  const sessionLabel = !loading && user ? "Account" : "Sign in";
  const sessionMeta = !loading && user ? "Dashboard & license" : "Or create account";

  return (
    <nav className="home-deck" aria-label="Get started">
      <button
        type="button"
        disabled={disabled}
        className="home-deck__cell home-deck__cell--download"
        onClick={() => onNavigate("download")}
      >
        <span className="home-deck__eyebrow">Windows</span>
        <span className="home-deck__title home-deck__title--mint">Download</span>
        <span className="home-deck__meta">Free to try</span>
      </button>

      <button
        type="button"
        disabled={disabled}
        className="home-deck__cell home-deck__cell--buy"
        aria-label="Purchase Pro for 49 dollars, one time"
        onClick={() => onNavigate("pricing")}
      >
        <span className="home-deck__eyebrow">Pro export</span>
        <span className="home-deck__price">$49</span>
        <span className="home-deck__meta">Pay once</span>
      </button>

      <button
        type="button"
        disabled={disabled}
        className="home-deck__cell home-deck__cell--session"
        onClick={() => onNavigate("sign-in")}
      >
        <span className="home-deck__eyebrow">Your license</span>
        <span className="home-deck__title home-deck__title--mono">{sessionLabel}</span>
        <span className="home-deck__meta">{sessionMeta}</span>
      </button>
    </nav>
  );
}
