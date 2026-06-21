"use client";

import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { HomeBackControl } from "../HomeBackControl";

const FEATURES = [
  "All features, present and future",
  "Save locally or to Google Drive",
  "Up to 1080p · 60fps encoding",
  "Account links to desktop app",
  "Free updates, forever",
];

type HomePanelPricingProps = {
  onBack: () => void;
  onDownload: () => void;
  onCheckout: () => void;
  onSignUp: () => void;
};

export function HomePanelPricing({
  onBack,
  onDownload,
  onCheckout,
  onSignUp,
}: HomePanelPricingProps) {
  const { user, isPro } = useAuth();

  function handleBuy() {
    if (isPro) return;
    if (!user) {
      onSignUp();
      return;
    }
    onCheckout();
  }

  return (
    <section className="home-panel" aria-label="Pricing">
      <HomeBackControl onBack={onBack} />
      <p className="home-panel__kicker">Pro export</p>
      <h2 className="home-panel__heading">One price. Yours for good.</h2>
      <p className="home-panel__lede">
        Pay once — no subscription. The app is free to{" "}
        <button type="button" className="home-panel__inline" onClick={onDownload}>
          download and try
        </button>{" "}
        before you buy.
      </p>

      <div className="home-panel__card home-panel__card--price">
        <div className="home-panel__price-row">
          <span className="home-panel__price">$49</span>
          <span className="home-panel__price-meta">USD · one-time</span>
        </div>
        <ul className="home-panel__list home-panel__list--checks">
          {FEATURES.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
        {isPro ? (
          <Link href="/dashboard" className="home-panel__btn home-panel__btn--mint">
            Pro unlocked — open dashboard
          </Link>
        ) : (
          <button type="button" className="home-panel__btn home-panel__btn--coral" onClick={handleBuy}>
            {user ? "Buy Pro · $49" : "Sign up to buy"}
          </button>
        )}
      </div>
    </section>
  );
}
